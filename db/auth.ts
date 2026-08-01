import { getCloudflareContext } from "@opennextjs/cloudflare";

import { ensureDatabase } from ".";
import {
  expireCookie,
  hashSessionToken,
  SESSION_COOKIE,
} from "../lib/auth-core";
import {
  readCookie,
  workspaceCookie,
  workspaceForRequest,
  type Workspace,
} from "./http";

export type AuthUser = {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string;
};

export type Identity = Workspace & {
  user: AuthUser | null;
  sessionId?: string;
};

type SessionRow = {
  session_id: string;
  user_id: string;
  workspace_id: string;
  login: string;
  name: string | null;
  avatar_url: string;
};

export async function resolveIdentity(request: Request): Promise<Identity> {
  const guestWorkspace = workspaceForRequest(request);
  const token = sessionTokenForRequest(request);
  if (!token) return resolveGuestIdentity(request, guestWorkspace);

  if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) {
    return resolveGuestIdentity(
      request,
      workspaceWithExpiredSession(request, guestWorkspace),
    );
  }

  const tokenHash = await hashSessionToken(token);
  const db = await ensureDatabase();
  const session = await db
    .prepare(`
      SELECT s.id AS session_id, u.id AS user_id, u.workspace_id,
             u.login, u.name, u.avatar_url
      FROM sessions AS s
      INNER JOIN users AS u ON u.id = s.user_id
      WHERE s.token_hash = ?
        AND s.revoked_at IS NULL
        AND s.expires_at > ?
      LIMIT 1
    `)
    .bind(tokenHash, new Date().toISOString())
    .first<SessionRow>();

  if (!session) {
    return resolveGuestIdentity(
      request,
      workspaceWithExpiredSession(request, guestWorkspace),
    );
  }

  return {
    ...guestWorkspace,
    id: session.workspace_id,
    sessionId: session.session_id,
    user: {
      id: session.user_id,
      login: session.login,
      name: session.name,
      avatarUrl: session.avatar_url,
    },
  };
}

export function sessionTokenForRequest(request: Request) {
  return readCookie(request.headers.get("cookie") ?? "", SESSION_COOKIE);
}

export type GithubOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export async function githubOAuthConfig(
  request: Request,
): Promise<GithubOAuthConfig> {
  let runtimeEnv: Record<string, unknown> = {};
  try {
    const context = await getCloudflareContext({ async: true });
    runtimeEnv = context.env as unknown as Record<string, unknown>;
  } catch {
    // Standard Next.js development does not expose a Cloudflare context.
  }

  const clientId = runtimeString(runtimeEnv.GITHUB_CLIENT_ID)
    ?? runtimeString(process.env.GITHUB_CLIENT_ID);
  const clientSecret = runtimeString(runtimeEnv.GITHUB_CLIENT_SECRET)
    ?? runtimeString(process.env.GITHUB_CLIENT_SECRET);
  const configuredCallback = runtimeString(runtimeEnv.GITHUB_CALLBACK_URL)
    ?? runtimeString(process.env.GITHUB_CALLBACK_URL);

  if (!clientId || !clientSecret) {
    throw new AuthConfigurationError(
      "GitHub sign-in is not configured on this deployment",
    );
  }

  const redirectUri = configuredCallback
    ?? new URL("/api/auth/github/callback", request.url).toString();
  try {
    const callbackUrl = new URL(redirectUri);
    if (!/^https?:$/.test(callbackUrl.protocol)) throw new Error("protocol");
  } catch {
    throw new AuthConfigurationError("GitHub callback URL is invalid");
  }

  return { clientId, clientSecret, redirectUri };
}

export class AuthConfigurationError extends Error {}

export async function claimGuestWorkspaceAndCreateSession({
  db,
  guestWorkspaceId,
  accountWorkspaceId,
  userId,
  sessionId,
  tokenHash,
  expiresAt,
  now,
}: {
  db: D1Database;
  guestWorkspaceId: string;
  accountWorkspaceId: string;
  userId: string;
  sessionId: string;
  tokenHash: string;
  expiresAt: string;
  now: string;
}) {
  const results = await db.batch<Record<string, unknown>>([
    db
      .prepare(`
        UPDATE projects
        SET workspace_id = ?, updated_at = ?
        WHERE workspace_id = ?
          AND ? <> ?
          AND NOT EXISTS (
            SELECT 1 FROM users WHERE workspace_id = ?
          )
        RETURNING id
      `)
      .bind(
        accountWorkspaceId,
        now,
        guestWorkspaceId,
        guestWorkspaceId,
        accountWorkspaceId,
        guestWorkspaceId,
      ),
    db
      .prepare(`
        INSERT INTO sessions (
          id, user_id, token_hash, expires_at, revoked_at, created_at
        ) VALUES (?, ?, ?, ?, NULL, ?)
      `)
      .bind(sessionId, userId, tokenHash, expiresAt, now),
  ]);
  return results[0]?.results.length ?? 0;
}

async function resolveGuestIdentity(
  request: Request,
  workspace: Workspace,
): Promise<Identity> {
  const db = await ensureDatabase();
  const accountOwner = await db
    .prepare("SELECT 1 AS found FROM users WHERE workspace_id = ? LIMIT 1")
    .bind(workspace.id)
    .first<{ found: number }>();

  if (!accountOwner) return { ...workspace, user: null };

  const rotatedId = crypto.randomUUID();
  return {
    id: rotatedId,
    setCookie: workspaceCookie(request, rotatedId),
    additionalSetCookies: workspace.additionalSetCookies,
    user: null,
  };
}

function workspaceWithExpiredSession(
  request: Request,
  workspace: Workspace,
): Workspace {
  return {
    ...workspace,
    additionalSetCookies: [
      ...(workspace.additionalSetCookies ?? []),
      expireCookie(request, SESSION_COOKIE),
    ],
  };
}

function runtimeString(value: unknown) {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  return cleaned || undefined;
}
