export const SESSION_COOKIE = "atoms_session";
export const OAUTH_STATE_COOKIE = "atoms_oauth_state";
export const OAUTH_PKCE_COOKIE = "atoms_oauth_pkce";

export const OAUTH_COOKIE_MAX_AGE = 10 * 60;
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export function createAccountWorkspaceId() {
  return `account_${crypto.randomUUID()}`;
}

export type GithubProfile = {
  githubId: string;
  login: string;
  name: string | null;
  avatarUrl: string;
};

export function randomOpaqueToken(byteLength = 32) {
  if (!Number.isInteger(byteLength) || byteLength < 16) {
    throw new TypeError("byteLength must be an integer of at least 16");
  }
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return base64Url(bytes);
}

export async function hashSessionToken(token: string) {
  return sha256Base64Url(token);
}

export async function createPkcePair() {
  const verifier = randomOpaqueToken(32);
  return {
    verifier,
    challenge: await sha256Base64Url(verifier),
  };
}

export async function sha256Base64Url(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return base64Url(new Uint8Array(digest));
}

export function constantTimeEqual(left: string, right: string) {
  const maxLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export function validateOAuthCallback({
  expectedState,
  returnedState,
  verifier,
  code,
  providerError,
}: {
  expectedState?: string;
  returnedState?: string | null;
  verifier?: string;
  code?: string | null;
  providerError?: string | null;
}) {
  if (
    providerError
    || !expectedState
    || !returnedState
    || !constantTimeEqual(expectedState, returnedState)
    || !verifier
    || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier)
    || !code
    || code.length > 512
  ) {
    return null;
  }
  return { code, verifier };
}

export function buildGithubAuthorizationUrl({
  clientId,
  redirectUri,
  state,
  codeChallenge,
}: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}) {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  // Intentionally omit `scope`: GitHub then grants public profile access only.
  return url;
}

export function parseGithubProfile(value: unknown): GithubProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("GitHub returned an invalid profile");
  }

  const profile = value as Record<string, unknown>;
  const githubId = parseGithubId(profile.id);
  const login = cleanRequiredString(profile.login, "login", 64);
  const avatarUrl = cleanRequiredString(profile.avatar_url, "avatar_url", 2_048);
  const name = cleanOptionalString(profile.name, 200);

  let parsedAvatar: URL;
  try {
    parsedAvatar = new URL(avatarUrl);
  } catch {
    throw new TypeError("GitHub returned an invalid avatar URL");
  }
  if (parsedAvatar.protocol !== "https:") {
    throw new TypeError("GitHub avatar URL must use HTTPS");
  }

  return { githubId, login, name, avatarUrl: parsedAvatar.toString() };
}

export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function secureCookie(
  request: Request,
  name: string,
  value: string,
  {
    maxAge,
    path = "/",
  }: {
    maxAge: number;
    path?: string;
  },
) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

export function expireCookie(request: Request, name: string, path = "/") {
  return secureCookie(request, name, "", { maxAge: 0, path });
}

function parseGithubId(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  if (typeof value === "string" && /^[1-9][0-9]{0,30}$/.test(value)) {
    return value;
  }
  throw new TypeError("GitHub returned an invalid user id");
}

function cleanRequiredString(value: unknown, field: string, maxLength: number) {
  if (typeof value !== "string") {
    throw new TypeError(`GitHub profile ${field} must be a string`);
  }
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maxLength) {
    throw new TypeError(`GitHub profile ${field} is invalid`);
  }
  return cleaned;
}

function cleanOptionalString(value: unknown, maxLength: number) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new TypeError("GitHub profile name must be a string or null");
  }
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
