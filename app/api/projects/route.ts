import { ensureDatabase } from "../../../db";
import { resolveIdentity } from "../../../db/auth";
import {
  assertSameOriginMutation,
  errorResponse,
  jsonResponse,
  jsonText,
  optionalString,
  readJsonObject,
  workspaceForRequest,
  type Workspace,
} from "../../../db/http";
import {
  serializeProject,
  type DatabaseRow,
} from "../../../db/serializers";

export async function GET(request: Request) {
  let workspace: Workspace = workspaceForRequest(request);
  try {
    workspace = await resolveIdentity(request);
    const db = await ensureDatabase();
    const result = await db
      .prepare(`
        SELECT id, workspace_id, title, prompt, current_spec, records,
               current_version, created_at, updated_at
        FROM projects
        WHERE workspace_id = ?
        ORDER BY updated_at DESC, id DESC
        LIMIT 100
      `)
      .bind(workspace.id)
      .all<DatabaseRow>();

    return jsonResponse(workspace, {
      projects: result.results.map(serializeProject),
    });
  } catch (error) {
    return errorResponse(workspace, error);
  }
}

export async function POST(request: Request) {
  let workspace: Workspace = workspaceForRequest(request);
  try {
    assertSameOriginMutation(request);
    workspace = await resolveIdentity(request);
    const payload = await readJsonObject(request);
    const prompt = optionalString(payload, "prompt", 20_000) ?? "";
    const requestedTitle =
      optionalString(payload, "title", 200) ??
      optionalString(payload, "name", 200);
    const title = requestedTitle || titleFromPrompt(prompt);
    const rawSpec = payload.spec === undefined ? payload.currentSpec : payload.spec;
    const spec = jsonText(rawSpec, {});
    const records = jsonText(payload.records, []);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const db = await ensureDatabase();

    const project = await db
      .prepare(`
        INSERT INTO projects (
          id, workspace_id, title, prompt, current_spec, records,
          current_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
        RETURNING id, workspace_id, title, prompt, current_spec, records,
                  current_version, created_at, updated_at
      `)
      .bind(id, workspace.id, title, prompt, spec, records, now, now)
      .first<DatabaseRow>();
    if (!project) {
      throw new Error("Project was not created");
    }
    return jsonResponse(
      workspace,
      { project: serializeProject(project) },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(workspace, error);
  }
}

function titleFromPrompt(prompt: string) {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (!normalized) return "Untitled project";
  return normalized.length > 64 ? `${normalized.slice(0, 61)}...` : normalized;
}
