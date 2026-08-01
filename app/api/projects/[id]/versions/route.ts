import { ensureDatabase } from "../../../../../db";
import {
  errorResponse,
  jsonResponse,
  jsonText,
  optionalString,
  parseStoredJson,
  readJsonObject,
  RequestError,
  workspaceForRequest,
} from "../../../../../db/http";
import {
  serializeProject,
  serializeVersion,
  type DatabaseRow,
} from "../../../../../db/serializers";
import type { AppSpec } from "@/lib/domain";
import { parseAppSpec, parseRecords } from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string }> };

const PROJECT_COLUMNS = `
  id, workspace_id, title, prompt, current_spec, records,
  current_version, created_at, updated_at
`;

export async function GET(request: Request, { params }: RouteContext) {
  const workspace = workspaceForRequest(request);
  try {
    const { id } = await params;
    const db = await ensureDatabase();
    const result = await db
      .prepare(`
        SELECT v.id, v.project_id, v.version, v.instruction, v.spec,
               v.records, v.prompt, v.provider, v.model, v.warning, v.stages,
               v.created_at
        FROM versions AS v
        INNER JOIN projects AS p ON p.id = v.project_id
        WHERE v.project_id = ? AND p.workspace_id = ?
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
  const workspace = workspaceForRequest(request);
  try {
    const { id } = await params;
    const payload = await readJsonObject(request);
    if (payload.action !== undefined && payload.action !== "rollback") {
      throw new RequestError(400, "action must be rollback when provided");
    }
    if (payload.action === "rollback") {
      return await rollbackVersion(workspace, id, payload);
    }

    const prompt = optionalString(payload, "prompt", 20_000);
    const instruction =
      optionalString(payload, "instruction", 20_000) ?? prompt ?? "";
    const hasSpec =
      Object.hasOwn(payload, "spec") || Object.hasOwn(payload, "currentSpec");
    const rawSpec = Object.hasOwn(payload, "spec")
      ? payload.spec
      : payload.currentSpec;
    const db = await ensureDatabase();
    const parsedSpec = hasSpec ? validSpec(rawSpec) : null;
    const spec = parsedSpec ? jsonText(parsedSpec, {}) : null;
    let records: string | null = null;
    if (Object.hasOwn(payload, "records")) {
      let recordsSpec = parsedSpec;
      if (!recordsSpec) {
        const current = await db
          .prepare(`
            SELECT current_spec
            FROM projects
            WHERE id = ? AND workspace_id = ?
          `)
          .bind(id, workspace.id)
          .first<DatabaseRow>();
        if (!current) {
          return jsonResponse(workspace, { error: "Project not found" }, { status: 404 });
        }
        recordsSpec = validSpec(parseStoredJson(current.current_spec, {}));
      }
      records = jsonText(validRecords(payload.records, recordsSpec), []);
    }
    const provider = optionalString(payload, "provider", 80) ?? null;
    const model = optionalString(payload, "model", 120) ?? null;
    const warning = optionalString(payload, "warning", 2_000) ?? null;
    const stages = jsonText(payload.stages, []);
    const versionId = crypto.randomUUID();
    const now = new Date().toISOString();
    const results = await db.batch<DatabaseRow>([
      db
        .prepare(`
          INSERT INTO versions (
            id, project_id, version, instruction, spec, records, prompt,
            provider, model, warning, stages, created_at
          )
          SELECT ?, id, current_version + 1, ?, COALESCE(?, current_spec),
                 COALESCE(?, records), COALESCE(?, prompt), ?, ?, ?, ?, ?
          FROM projects
          WHERE id = ? AND workspace_id = ?
          RETURNING id, project_id, version, instruction, spec, records, prompt,
                    provider, model, warning, stages, created_at
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
          WHERE id = ? AND workspace_id = ?
        `)
        .bind(spec, records, prompt, now, id, workspace.id),
      db
        .prepare(`
          SELECT ${PROJECT_COLUMNS}
          FROM projects
          WHERE id = ? AND workspace_id = ?
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
  const workspace = workspaceForRequest(request);
  try {
    const { id } = await params;
    const payload = await readJsonObject(request);
    if (!Object.hasOwn(payload, "records")) {
      throw new RequestError(400, "records is required");
    }
    const versionId = optionalString(payload, "versionId", 100);
    if (!versionId) {
      throw new RequestError(400, "versionId is required");
    }
    const now = new Date().toISOString();
    const db = await ensureDatabase();
    const current = await db
      .prepare(`
        SELECT v.spec
        FROM versions AS v
        INNER JOIN projects AS p ON p.id = v.project_id
        WHERE v.id = ? AND v.project_id = ? AND p.workspace_id = ?
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
    const currentSpec = validSpec(parseStoredJson(current.spec, {}));
    const records = jsonText(validRecords(payload.records, currentSpec), []);
    const results = await db.batch<DatabaseRow>([
      db
        .prepare(`
          UPDATE versions
          SET records = ?
          WHERE id = ? AND project_id = ?
            AND version = (
              SELECT current_version FROM projects
              WHERE id = ? AND workspace_id = ?
            )
          RETURNING id
        `)
        .bind(records, versionId, id, id, workspace.id),
      db
        .prepare(`
          UPDATE projects
          SET records = ?, updated_at = ?
          WHERE id = ? AND workspace_id = ?
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

function validSpec(value: unknown): AppSpec {
  try {
    return parseAppSpec(value);
  } catch {
    throw new RequestError(400, "spec must be a valid AppSpec");
  }
}

function validRecords(value: unknown, spec: AppSpec) {
  try {
    return parseRecords(value, spec);
  } catch {
    throw new RequestError(400, "records must match the current AppSpec");
  }
}

async function rollbackVersion(
  workspace: ReturnType<typeof workspaceForRequest>,
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
             v.model, v.warning, v.stages
      FROM versions AS v
      INNER JOIN projects AS p ON p.id = v.project_id
      WHERE v.id = ? AND v.project_id = ? AND p.workspace_id = ?
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

  const versionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const instruction = `Rollback to version ${String(source.version)}`;
  const results = await db.batch<DatabaseRow>([
    db
      .prepare(`
        INSERT INTO versions (
          id, project_id, version, instruction, spec, records, prompt,
          provider, model, warning, stages, created_at
        )
        SELECT ?, id, current_version + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?
        FROM projects
        WHERE id = ? AND workspace_id = ?
        RETURNING id, project_id, version, instruction, spec, records, prompt,
                  provider, model, warning, stages, created_at
      `)
      .bind(
        versionId,
        instruction,
        source.spec,
        source.records,
        source.prompt,
        source.provider,
        source.model,
        source.warning,
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
        WHERE id = ? AND workspace_id = ?
      `)
      .bind(source.spec, source.records, now, projectId, workspace.id),
    db
      .prepare(`
        SELECT ${PROJECT_COLUMNS}
        FROM projects
        WHERE id = ? AND workspace_id = ?
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
