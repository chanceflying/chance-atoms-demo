import { ensureDatabase } from "../../../../../db";
import { resolveIdentity } from "../../../../../db/auth";
import {
  assertSameOriginMutation,
  errorResponse,
  jsonResponse,
  jsonText,
  optionalString,
  parseStoredJson,
  readJsonObject,
  RequestError,
  workspaceForRequest,
  type Workspace,
} from "../../../../../db/http";
import {
  serializeProject,
  serializeVersion,
  type DatabaseRow,
} from "../../../../../db/serializers";
import {
  isWebAppArtifact,
  parseBuildPlan,
  parseRecordsForArtifact,
  parseStoredArtifact,
  type StoredArtifact,
} from "@/lib";

type RouteContext = { params: Promise<{ id: string }> };

const PROJECT_COLUMNS = `
  id, workspace_id, title, prompt, current_spec, records,
  current_version, created_at, updated_at
`;

export async function GET(request: Request, { params }: RouteContext) {
  let workspace: Workspace = workspaceForRequest(request);
  try {
    workspace = await resolveIdentity(request);
    const { id } = await params;
    const db = await ensureDatabase();
    if (!(await hasWebAppProject(db, id, workspace.id))) {
      return projectNotFound(workspace);
    }
    const result = await db
      .prepare(`
        SELECT v.id, v.project_id, v.version, v.instruction, v.spec,
               v.records, v.prompt, v.provider, v.model, v.warning, v.stages,
               v.build_plan, v.reasoning_summary,
               v.created_at
        FROM versions AS v
        INNER JOIN projects AS p ON p.id = v.project_id
        WHERE v.project_id = ? AND p.workspace_id = ? AND p.kind = 'web_app'
        ORDER BY v.version DESC
        LIMIT 100
      `)
      .bind(id, workspace.id)
      .all<DatabaseRow>();

    return jsonResponse(workspace, {
      versions: result.results.map(serializeVersion),
    });
  } catch (error) {
    return errorResponse(workspace, error);
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  let workspace: Workspace = workspaceForRequest(request);
  try {
    assertSameOriginMutation(request);
    workspace = await resolveIdentity(request);
    const { id } = await params;
    const payload = await readJsonObject(request);
    const db = await ensureDatabase();
    if (!(await hasWebAppProject(db, id, workspace.id))) {
      return projectNotFound(workspace);
    }
    if (payload.action !== undefined && payload.action !== "rollback") {
      throw new RequestError(400, "action must be rollback when provided");
    }
    if (payload.action === "rollback") {
      return await rollbackVersion(workspace, id, payload);
    }

    const prompt = optionalString(payload, "prompt", 20_000);
    const instruction =
      optionalString(payload, "instruction", 20_000) ?? prompt ?? "";
    const hasArtifact =
      Object.hasOwn(payload, "artifact")
      || Object.hasOwn(payload, "spec")
      || Object.hasOwn(payload, "currentSpec");
    const rawArtifact = Object.hasOwn(payload, "artifact")
      ? payload.artifact
      : Object.hasOwn(payload, "spec")
        ? payload.spec
        : payload.currentSpec;
    const parsedArtifact = hasArtifact ? validArtifact(rawArtifact) : null;
    const spec = parsedArtifact ? jsonText(parsedArtifact, {}) : null;
    let records: string | null = parsedArtifact && isWebAppArtifact(parsedArtifact)
      ? "[]"
      : null;
    if (Object.hasOwn(payload, "records")) {
      let recordsArtifact = parsedArtifact;
      if (!recordsArtifact) {
        const current = await db
          .prepare(`
            SELECT current_spec
            FROM projects
            WHERE id = ? AND workspace_id = ? AND kind = 'web_app'
          `)
          .bind(id, workspace.id)
          .first<DatabaseRow>();
        if (!current) {
          return jsonResponse(workspace, { error: "Project not found" }, { status: 404 });
        }
        recordsArtifact = validArtifact(parseStoredJson(current.current_spec, {}));
      }
      records = jsonText(
        validRecordsForArtifact(payload.records, recordsArtifact),
        [],
      );
    }
    const provider = optionalString(payload, "provider", 80) ?? null;
    const model = optionalString(payload, "model", 120) ?? null;
    const warning = optionalString(payload, "warning", 2_000) ?? null;
    const buildPlan = Object.hasOwn(payload, "buildPlan")
      ? jsonText(validBuildPlan(payload.buildPlan), {})
      : null;
    const reasoningSummary = Object.hasOwn(payload, "reasoningSummary")
      ? jsonText(validReasoningSummary(payload.reasoningSummary), [])
      : null;
    const stages = jsonText(payload.stages, []);
    const versionId = crypto.randomUUID();
    const now = new Date().toISOString();
    const results = await db.batch<DatabaseRow>([
      db
        .prepare(`
          INSERT INTO versions (
            id, project_id, version, instruction, spec, records, prompt,
            provider, model, warning, build_plan, reasoning_summary, stages,
            created_at
          )
          SELECT ?, id, current_version + 1, ?, COALESCE(?, current_spec),
                 COALESCE(?, records), COALESCE(?, prompt), ?, ?, ?,
                 COALESCE(?, '{}'), COALESCE(?, '[]'), ?, ?
          FROM projects
          WHERE id = ? AND workspace_id = ? AND kind = 'web_app'
          RETURNING id, project_id, version, instruction, spec, records, prompt,
                    provider, model, warning, build_plan, reasoning_summary,
                    stages, created_at
        `)
        .bind(
          versionId,
          instruction,
          spec,
          records,
          prompt,
          provider,
          model,
          warning,
          buildPlan,
          reasoningSummary,
          stages,
          now,
          id,
          workspace.id,
        ),
      db
        .prepare(`
          UPDATE projects
          SET current_spec = COALESCE(?, current_spec),
              records = COALESCE(?, records),
              prompt = COALESCE(?, prompt),
              current_version = current_version + 1,
              updated_at = ?
          WHERE id = ? AND workspace_id = ? AND kind = 'web_app'
        `)
        .bind(spec, records, prompt, now, id, workspace.id),
      db
        .prepare(`
          SELECT ${PROJECT_COLUMNS}
          FROM projects
          WHERE id = ? AND workspace_id = ? AND kind = 'web_app'
        `)
        .bind(id, workspace.id),
    ]);

    const version = results[0].results[0];
    if (!version) {
      return jsonResponse(workspace, { error: "Project not found" }, { status: 404 });
    }
    return jsonResponse(
      workspace,
      {
        version: serializeVersion(version),
        project: results[2].results[0]
          ? serializeProject(results[2].results[0])
          : undefined,
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(workspace, error);
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  let workspace: Workspace = workspaceForRequest(request);
  try {
    assertSameOriginMutation(request);
    workspace = await resolveIdentity(request);
    const { id } = await params;
    const payload = await readJsonObject(request);
    const db = await ensureDatabase();
    if (!(await hasWebAppProject(db, id, workspace.id))) {
      return projectNotFound(workspace);
    }
    if (!Object.hasOwn(payload, "records")) {
      throw new RequestError(400, "records is required");
    }
    const versionId = optionalString(payload, "versionId", 100);
    if (!versionId) {
      throw new RequestError(400, "versionId is required");
    }
    const now = new Date().toISOString();
    const current = await db
      .prepare(`
        SELECT v.spec
        FROM versions AS v
        INNER JOIN projects AS p ON p.id = v.project_id
        WHERE v.id = ? AND v.project_id = ? AND p.workspace_id = ?
          AND p.kind = 'web_app'
          AND v.version = p.current_version
      `)
      .bind(versionId, id, workspace.id)
      .first<DatabaseRow>();
    if (!current) {
      return jsonResponse(
        workspace,
        { error: "Only the current version can be edited" },
        { status: 409 },
      );
    }
    const currentArtifact = validArtifact(parseStoredJson(current.spec, {}));
    const records = jsonText(
      validRecordsForArtifact(payload.records, currentArtifact),
      [],
    );
    const results = await db.batch<DatabaseRow>([
      db
        .prepare(`
          UPDATE versions
          SET records = ?
          WHERE id = ? AND project_id = ?
            AND version = (
              SELECT current_version FROM projects
              WHERE id = ? AND workspace_id = ? AND kind = 'web_app'
            )
          RETURNING id
        `)
        .bind(records, versionId, id, id, workspace.id),
      db
        .prepare(`
          UPDATE projects
          SET records = ?, updated_at = ?
          WHERE id = ? AND workspace_id = ? AND kind = 'web_app'
            AND current_version = (
              SELECT version FROM versions
              WHERE id = ? AND project_id = ?
            )
          RETURNING ${PROJECT_COLUMNS}
        `)
        .bind(records, now, id, workspace.id, versionId, id),
    ]);

    const project = results[1].results[0];
    if (!results[0].results[0] || !project) {
      return jsonResponse(
        workspace,
        { error: "Only the current version can be edited" },
        { status: 409 },
      );
    }
    return jsonResponse(workspace, { project: serializeProject(project) });
  } catch (error) {
    return errorResponse(workspace, error);
  }
}

function validArtifact(value: unknown): StoredArtifact {
  try {
    return parseStoredArtifact(value);
  } catch {
    throw new RequestError(400, "spec must be a valid stored artifact");
  }
}

function validRecordsForArtifact(value: unknown, artifact: StoredArtifact) {
  try {
    return parseRecordsForArtifact(value, artifact);
  } catch {
    throw new RequestError(400, "records must match the current artifact");
  }
}

function validBuildPlan(value: unknown) {
  try {
    return parseBuildPlan(value);
  } catch {
    throw new RequestError(400, "buildPlan must be a valid Web App build plan");
  }
}

function validReasoningSummary(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 8) {
    throw new RequestError(400, "reasoningSummary must be a short string array");
  }
  return value.map((item) => {
    if (typeof item !== "string" || !item.trim() || item.length > 2_000) {
      throw new RequestError(400, "reasoningSummary contains an invalid item");
    }
    return item.trim();
  });
}

async function rollbackVersion(
  workspace: Workspace,
  projectId: string,
  payload: Record<string, unknown>,
) {
  const sourceVersionId = optionalString(payload, "sourceVersionId", 100);
  if (!sourceVersionId) {
    throw new RequestError(400, "sourceVersionId is required for rollback");
  }

  const db = await ensureDatabase();
  const source = await db
    .prepare(`
      SELECT v.version, v.spec, v.records, v.prompt, v.provider,
             v.model, v.warning, v.build_plan, v.reasoning_summary, v.stages
      FROM versions AS v
      INNER JOIN projects AS p ON p.id = v.project_id
      WHERE v.id = ? AND v.project_id = ? AND p.workspace_id = ?
        AND p.kind = 'web_app'
    `)
    .bind(sourceVersionId, projectId, workspace.id)
    .first<DatabaseRow>();
  if (!source || typeof source.spec !== "string") {
    return jsonResponse(
      workspace,
      { error: "Source version not found" },
      { status: 404 },
    );
  }
  const sourceArtifact = validArtifact(parseStoredJson(source.spec, {}));
  const sourceRecords = jsonText(
    validRecordsForArtifact(parseStoredJson(source.records, []), sourceArtifact),
    [],
  );

  const versionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const instruction = `Rollback to version ${String(source.version)}`;
  const results = await db.batch<DatabaseRow>([
    db
      .prepare(`
        INSERT INTO versions (
          id, project_id, version, instruction, spec, records, prompt,
          provider, model, warning, build_plan, reasoning_summary, stages,
          created_at
        )
        SELECT ?, id, current_version + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        FROM projects
        WHERE id = ? AND workspace_id = ? AND kind = 'web_app'
        RETURNING id, project_id, version, instruction, spec, records, prompt,
                  provider, model, warning, build_plan, reasoning_summary,
                  stages, created_at
      `)
      .bind(
        versionId,
        instruction,
        source.spec,
        sourceRecords,
        source.prompt,
        source.provider,
        source.model,
        source.warning,
        source.build_plan,
        source.reasoning_summary,
        source.stages,
        now,
        projectId,
        workspace.id,
      ),
    db
      .prepare(`
        UPDATE projects
        SET current_spec = ?, records = ?, current_version = current_version + 1,
            updated_at = ?
        WHERE id = ? AND workspace_id = ? AND kind = 'web_app'
      `)
      .bind(source.spec, sourceRecords, now, projectId, workspace.id),
    db
      .prepare(`
        SELECT ${PROJECT_COLUMNS}
        FROM projects
        WHERE id = ? AND workspace_id = ? AND kind = 'web_app'
      `)
      .bind(projectId, workspace.id),
  ]);

  const version = results[0].results[0];
  if (!version) {
    return jsonResponse(workspace, { error: "Project not found" }, { status: 404 });
  }
  return jsonResponse(
    workspace,
    {
      version: serializeVersion(version),
      project: results[2].results[0]
        ? serializeProject(results[2].results[0])
        : undefined,
    },
    { status: 201 },
  );
}

async function hasWebAppProject(
  db: D1Database,
  projectId: string,
  workspaceId: string,
) {
  const project = await db
    .prepare(`
      SELECT 1 AS found
      FROM projects
      WHERE id = ? AND workspace_id = ? AND kind = 'web_app'
      LIMIT 1
    `)
    .bind(projectId, workspaceId)
    .first<{ found: number }>();
  return Boolean(project);
}

function projectNotFound(workspace: Workspace) {
  return jsonResponse(workspace, { error: "Project not found" }, { status: 404 });
}
