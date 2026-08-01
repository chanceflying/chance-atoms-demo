import { ensureDatabase } from "../../../../../db";
import { resolveIdentity } from "../../../../../db/auth";
import {
  assertSameOriginMutation,
  errorResponse,
  jsonResponse,
  optionalString,
  readJsonObject,
  RequestError,
  workspaceForRequest,
  type Workspace,
} from "../../../../../db/http";
import {
  serializeChatMessage,
  type DatabaseRow,
} from "../../../../../db/serializers";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  let workspace: Workspace = workspaceForRequest(request);
  try {
    workspace = await resolveIdentity(request);
    const { id } = await params;
    const db = await ensureDatabase();
    const project = await findChatProject(db, id, workspace.id);
    if (!project) return chatProjectNotFound(workspace);

    const result = await db
      .prepare(`
        SELECT id, project_id, role, content, provider, model, created_at
        FROM chat_messages
        WHERE project_id = ?
        ORDER BY created_at ASC, rowid ASC
      `)
      .bind(id)
      .all<DatabaseRow>();
    const memoryEnabled = Boolean(project.memory_enabled);
    const memoryContent = stringValue(project.memory_content);

    return jsonResponse(workspace, {
      projectId: id,
      memoryEnabled,
      memoryContent,
      memory: { enabled: memoryEnabled, content: memoryContent },
      messages: result.results.map(serializeChatMessage),
    });
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
    const assignments: string[] = [];
    const values: unknown[] = [];
    if (Object.hasOwn(payload, "memoryEnabled")) {
      assignments.push("memory_enabled = ?");
      values.push(requiredBoolean(payload, "memoryEnabled") ? 1 : 0);
    }
    if (Object.hasOwn(payload, "memoryContent")) {
      assignments.push("memory_content = ?");
      values.push(requiredMemoryContent(payload));
    }
    if (assignments.length === 0) {
      throw new RequestError(
        400,
        "PATCH requires memoryEnabled or memoryContent",
      );
    }
    const now = new Date().toISOString();
    const db = await ensureDatabase();
    assignments.push("updated_at = ?");
    values.push(now, id, workspace.id);
    const updated = await db
      .prepare(`
        UPDATE projects
        SET ${assignments.join(", ")}
        WHERE id = ? AND workspace_id = ? AND kind = 'chat'
        RETURNING id, memory_enabled, memory_content, updated_at
      `)
      .bind(...values)
      .first<DatabaseRow>();
    if (!updated) return chatProjectNotFound(workspace);

    return jsonResponse(workspace, {
      projectId: id,
      memoryEnabled: Boolean(updated.memory_enabled),
      memoryContent: stringValue(updated.memory_content),
      memory: {
        enabled: Boolean(updated.memory_enabled),
        content: stringValue(updated.memory_content),
      },
      updatedAt: updated.updated_at,
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
    const project = await findChatProject(db, id, workspace.id);
    if (!project) return chatProjectNotFound(workspace);

    if (Object.hasOwn(payload, "role") || Object.hasOwn(payload, "content")) {
      const role = requiredRole(payload);
      const content = requiredChatContent(payload);
      const provider = role === "assistant"
        ? optionalString(payload, "provider", 200) ?? null
        : null;
      const model = role === "assistant"
        ? optionalString(payload, "model", 200) ?? null
        : null;
      const messageId = optionalString(payload, "messageId", 200) ?? crypto.randomUUID();
      const requestedCreatedAt = optionalString(payload, "createdAt", 100);
      const createdAt = requestedCreatedAt && !Number.isNaN(Date.parse(requestedCreatedAt))
        ? new Date(requestedCreatedAt).toISOString()
        : new Date().toISOString();

      await db.batch([
        db
          .prepare(`
            INSERT OR IGNORE INTO chat_messages (
              id, project_id, role, content, provider, model, created_at
            )
            SELECT ?, id, ?, ?, ?, ?, ?
            FROM projects
            WHERE id = ? AND workspace_id = ? AND kind = 'chat'
          `)
          .bind(
            messageId,
            role,
            content,
            provider,
            model,
            createdAt,
            id,
            workspace.id,
          ),
        db
          .prepare(`
            UPDATE projects
            SET updated_at = ?
            WHERE id = ? AND workspace_id = ? AND kind = 'chat'
          `)
          .bind(createdAt, id, workspace.id),
      ]);

      const saved = await db
        .prepare(`
          SELECT id, project_id, role, content, provider, model, created_at
          FROM chat_messages
          WHERE id = ? AND project_id = ?
        `)
        .bind(messageId, id)
        .first<DatabaseRow>();
      if (!saved) throw new Error("Chat message was not saved");

      return jsonResponse(
        workspace,
        { message: serializeChatMessage(saved), messages: [serializeChatMessage(saved)] },
        { status: 201 },
      );
    }

    const userMessage = requiredMessage(payload, "userMessage");
    const assistantMessage = requiredMessage(payload, "assistantMessage");
    const provider = optionalString(payload, "provider", 200) ?? null;
    const model = optionalString(payload, "model", 200) ?? null;
    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    const nowMs = Date.now();
    const userCreatedAt = new Date(nowMs).toISOString();
    const assistantCreatedAt = new Date(nowMs + 1).toISOString();
    const results = await db.batch<DatabaseRow>([
      db
        .prepare(`
          INSERT INTO chat_messages (
            id, project_id, role, content, provider, model, created_at
          )
          SELECT ?, id, 'user', ?, NULL, NULL, ?
          FROM projects
          WHERE id = ? AND workspace_id = ? AND kind = 'chat'
          RETURNING id, project_id, role, content, provider, model, created_at
        `)
        .bind(userId, userMessage, userCreatedAt, id, workspace.id),
      db
        .prepare(`
          INSERT INTO chat_messages (
            id, project_id, role, content, provider, model, created_at
          )
          SELECT ?, id, 'assistant', ?, ?, ?, ?
          FROM projects
          WHERE id = ? AND workspace_id = ? AND kind = 'chat'
          RETURNING id, project_id, role, content, provider, model, created_at
        `)
        .bind(
          assistantId,
          assistantMessage,
          provider,
          model,
          assistantCreatedAt,
          id,
          workspace.id,
        ),
      db
        .prepare(`
          UPDATE projects
          SET updated_at = ?
          WHERE id = ? AND workspace_id = ? AND kind = 'chat'
        `)
        .bind(assistantCreatedAt, id, workspace.id),
    ]);

    const userRow = results[0].results[0];
    const assistantRow = results[1].results[0];
    if (!userRow || !assistantRow) {
      throw new Error("Chat messages were not saved");
    }

    return jsonResponse(
      workspace,
      {
        messages: [
          serializeChatMessage(userRow),
          serializeChatMessage(assistantRow),
        ],
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(workspace, error);
  }
}

async function findChatProject(
  db: D1Database,
  id: string,
  workspaceId: string,
) {
  return db
    .prepare(`
      SELECT id, memory_enabled, memory_content
      FROM projects
      WHERE id = ? AND workspace_id = ? AND kind = 'chat'
    `)
    .bind(id, workspaceId)
    .first<DatabaseRow>();
}

function chatProjectNotFound(workspace: Workspace) {
  return jsonResponse(
    workspace,
    { error: "Chat project not found" },
    { status: 404 },
  );
}

function requiredBoolean(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (typeof value !== "boolean") {
    throw new RequestError(400, `${key} must be a boolean`);
  }
  return value;
}

function requiredMemoryContent(payload: Record<string, unknown>) {
  const value = payload.memoryContent;
  if (typeof value !== "string") {
    throw new RequestError(400, "memoryContent must be a string");
  }
  if (value.length > 12_000) {
    throw new RequestError(400, "memoryContent must be at most 12000 characters");
  }
  return value;
}

function requiredMessage(
  payload: Record<string, unknown>,
  key: "userMessage" | "assistantMessage",
) {
  const value = optionalString(payload, key, 200_000);
  if (!value) throw new RequestError(400, `${key} must not be empty`);
  return value;
}

function requiredRole(payload: Record<string, unknown>) {
  const role = payload.role;
  if (role !== "user" && role !== "assistant") {
    throw new RequestError(400, "role must be user or assistant");
  }
  return role;
}

function requiredChatContent(payload: Record<string, unknown>) {
  const value = optionalString(payload, "content", 200_000);
  if (!value) throw new RequestError(400, "content must not be empty");
  return value;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}
