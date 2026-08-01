const WORKSPACE_COOKIE = "atoms_workspace";
const WORKSPACE_MAX_AGE = 60 * 60 * 24 * 365;
const MAX_JSON_BODY_BYTES = 1_000_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type Workspace = {
  id: string;
  setCookie?: string;
};

export function workspaceForRequest(request: Request): Workspace {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const workspaceId = readCookie(cookieHeader, WORKSPACE_COOKIE);
  if (workspaceId && UUID_PATTERN.test(workspaceId)) {
    return { id: workspaceId };
  }

  const id = crypto.randomUUID();
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return {
    id,
    setCookie: `${WORKSPACE_COOKIE}=${id}; Path=/; Max-Age=${WORKSPACE_MAX_AGE}; HttpOnly; SameSite=Lax${secure}`,
  };
}

export function jsonResponse(
  workspace: Workspace,
  body: unknown,
  init: ResponseInit = {},
) {
  const headers = new Headers(init.headers);
  if (workspace.setCookie) headers.set("Set-Cookie", workspace.setCookie);
  return Response.json(body, { ...init, headers });
}

export async function readJsonObject(request: Request) {
  let value: unknown;
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
      throw new RequestError(413, "Request body is too large");
    }
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_JSON_BODY_BYTES) {
      throw new RequestError(413, "Request body is too large");
    }
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, "Request body must be valid JSON");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestError(400, "Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

export function optionalString(
  payload: Record<string, unknown>,
  key: string,
  maxLength: number,
) {
  const value = payload[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new RequestError(400, `${key} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new RequestError(400, `${key} must be at most ${maxLength} characters`);
  }
  return trimmed;
}

export function optionalNonNegativeInteger(
  payload: Record<string, unknown>,
  key: string,
) {
  const value = payload[key];
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new RequestError(400, `${key} must be a non-negative integer`);
  }
  return value as number;
}

export function jsonText(value: unknown, fallback: unknown) {
  const resolved = value === undefined ? fallback : value;
  const encoded = JSON.stringify(resolved);
  if (encoded === undefined) {
    throw new RequestError(400, "JSON value is not serializable");
  }
  if (encoded.length > 1_000_000) {
    throw new RequestError(413, "JSON value is too large");
  }
  return encoded;
}

export function parseStoredJson(value: unknown, fallback: unknown) {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fallback;
  }
}

export class RequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function errorResponse(workspace: Workspace, error: unknown) {
  if (error instanceof RequestError) {
    return jsonResponse(workspace, { error: error.message }, { status: error.status });
  }

  console.error(error);
  return jsonResponse(
    workspace,
    { error: "Unable to complete the database request" },
    { status: 500 },
  );
}

function readCookie(header: string, name: string) {
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}
