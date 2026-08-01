export const WORKSPACE_COOKIE = "atoms_workspace";
const WORKSPACE_MAX_AGE = 60 * 60 * 24 * 365;
const MAX_JSON_BODY_BYTES = 1_000_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type Workspace = {
  id: string;
  setCookie?: string;
  additionalSetCookies?: string[];
};

export function workspaceForRequest(request: Request): Workspace {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const workspaceId = readCookie(cookieHeader, WORKSPACE_COOKIE);
  if (workspaceId && UUID_PATTERN.test(workspaceId)) {
    return { id: workspaceId };
  }

  const id = crypto.randomUUID();
  return {
    id,
    setCookie: workspaceCookie(request, id),
  };
}

export function workspaceCookie(request: Request, id: string) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${WORKSPACE_COOKIE}=${encodeURIComponent(id)}; Path=/; Max-Age=${WORKSPACE_MAX_AGE}; HttpOnly; SameSite=Lax${secure}`;
}

export function jsonResponse(
  workspace: Workspace,
  body: unknown,
  init: ResponseInit = {},
) {
  const headers = new Headers(init.headers);
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", "private, no-store");
  }
  if (workspace.setCookie) headers.append("Set-Cookie", workspace.setCookie);
  for (const cookie of workspace.additionalSetCookies ?? []) {
    headers.append("Set-Cookie", cookie);
  }
  return Response.json(body, { ...init, headers });
}

export async function readJsonObject(request: Request) {
  const contentType = (request.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json" && !contentType.endsWith("+json")) {
    throw new RequestError(415, "Content-Type must be application/json");
  }

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

export function assertSameOriginMutation(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new RequestError(403, "Cross-origin mutation is not allowed");
  }

  const origin = request.headers.get("origin");
  if (!origin) return;
  try {
    if (new URL(origin).origin === new URL(request.url).origin) return;
  } catch {
    // Invalid origins are rejected below.
  }
  throw new RequestError(403, "Cross-origin mutation is not allowed");
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
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}

export function readCookie(header: string, name: string) {
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
