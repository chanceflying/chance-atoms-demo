import { ensureDatabase } from "../../../db";
import { resolveIdentity } from "../../../db/auth";
import {
  assertSameOriginMutation,
  errorResponse,
  jsonResponse,
  jsonText,
  optionalString,
  readJsonObject,
  RequestError,
  workspaceForRequest,
  type Workspace,
} from "../../../db/http";
import {
  serializeProject,
  type DatabaseRow,
} from "../../../db/serializers";
import {
  isWebAppArtifact,
  parseRecordsForArtifact,
  parseStoredArtifact,
  type StoredArtifact,
} from "@/lib";

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
    const rawArtifact = Object.hasOwn(payload, "artifact")
      ? payload.artifact
      : payload.spec === undefined
        ? payload.currentSpec
        : payload.spec;
    const artifact = rawArtifact === undefined ? null : validArtifact(rawArtifact);
    const spec = jsonText(artifact ?? undefined, {});
    const recordInput = artifact && !isWebAppArtifact(artifact)
      ? (payload.records ?? artifact.seedData)
      : payload.records;
    const records = artifact
      ? jsonText(validRecordsForArtifact(recordInput ?? [], artifact), [])
      : jsonText(payload.records, []);
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
