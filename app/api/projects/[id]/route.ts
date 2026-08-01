import { ensureDatabase } from "../../../../db";
import { resolveIdentity } from "../../../../db/auth";
import {
  assertSameOriginMutation,
  errorResponse,
  jsonResponse,
  jsonText,
  optionalNonNegativeInteger,
  optionalString,
  parseStoredJson,
  readJsonObject,
  RequestError,
  workspaceForRequest,
  type Workspace,
} from "../../../../db/http";
import {
  serializeProject,
  type DatabaseRow,
} from "../../../../db/serializers";
import {
  isWebAppArtifact,
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
    const project = await db
      .prepare(`
        SELECT ${PROJECT_COLUMNS}
        FROM projects
        WHERE id = ? AND workspace_id = ?
      `)
      .bind(id, workspace.id)
      .first<DatabaseRow>();

    if (!project) {
      return jsonResponse(workspace, { error: "Project not found" }, { status: 404 });
    }
    return jsonResponse(workspace, { project: serializeProject(project) });
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
    const assignments: string[] = [];
    const values: unknown[] = [];
    let artifact: StoredArtifact | null = null;

    if (Object.hasOwn(payload, "title")) {
      const title = optionalString(payload, "title", 200);
      if (!title) throw new RequestError(400, "title must not be empty");
      assignments.push("title = ?");
      values.push(title);
    }

    if (
      Object.hasOwn(payload, "artifact")
      || Object.hasOwn(payload, "spec")
      || Object.hasOwn(payload, "currentSpec")
    ) {
      const rawArtifact = Object.hasOwn(payload, "artifact")
        ? payload.artifact
        : Object.hasOwn(payload, "spec")
          ? payload.spec
          : payload.currentSpec;
      artifact = validArtifact(rawArtifact);
      assignments.push("current_spec = ?");
      values.push(jsonText(artifact, {}));
    }

    if (Object.hasOwn(payload, "records")) {
      if (!artifact) {
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
        artifact = optionalArtifact(parseStoredJson(current.current_spec, {}));
      }
      assignments.push("records = ?");
      values.push(
        artifact
          ? jsonText(validRecordsForArtifact(payload.records, artifact), [])
          : jsonText(payload.records, []),
      );
    } else if (artifact && isWebAppArtifact(artifact)) {
      assignments.push("records = ?");
      values.push("[]");
    }

    if (Object.hasOwn(payload, "currentVersion")) {
      assignments.push("current_version = ?");
      values.push(optionalNonNegativeInteger(payload, "currentVersion"));
    }

    if (assignments.length === 0) {
      throw new RequestError(
        400,
        "PATCH requires one of: title, artifact, spec, currentSpec, records, currentVersion",
      );
    }

    assignments.push("updated_at = ?");
    values.push(new Date().toISOString(), id, workspace.id);
    const updated = await db
      .prepare(`
        UPDATE projects
        SET ${assignments.join(", ")}
        WHERE id = ? AND workspace_id = ?
        RETURNING ${PROJECT_COLUMNS}
      `)
      .bind(...values)
      .first<DatabaseRow>();

    if (!updated) {
      return jsonResponse(workspace, { error: "Project not found" }, { status: 404 });
    }
    return jsonResponse(workspace, { project: serializeProject(updated) });
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

function optionalArtifact(value: unknown): StoredArtifact | null {
  try {
    return parseStoredArtifact(value);
  } catch {
    return null;
  }
}

function validRecordsForArtifact(value: unknown, artifact: StoredArtifact) {
  try {
    return parseRecordsForArtifact(value, artifact);
  } catch {
    throw new RequestError(400, "records must match the current artifact");
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  let workspace: Workspace = workspaceForRequest(request);
  try {
    assertSameOriginMutation(request);
    workspace = await resolveIdentity(request);
    const { id } = await params;
    const db = await ensureDatabase();
    const results = await db.batch<DatabaseRow>([
      db
        .prepare(`
          DELETE FROM versions
          WHERE project_id = ?
            AND EXISTS (
              SELECT 1 FROM projects
              WHERE projects.id = versions.project_id
                AND projects.workspace_id = ?
            )
        `)
        .bind(id, workspace.id),
      db
        .prepare(`
          DELETE FROM projects
          WHERE id = ? AND workspace_id = ?
          RETURNING id
        `)
        .bind(id, workspace.id),
    ]);

    if (!results[1].results[0]) {
      return jsonResponse(workspace, { error: "Project not found" }, { status: 404 });
    }
    return jsonResponse(workspace, { deleted: true, id });
  } catch (error) {
    return errorResponse(workspace, error);
  }
}
