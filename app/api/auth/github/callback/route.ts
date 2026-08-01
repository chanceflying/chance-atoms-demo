import { ensureDatabase } from "@/db";
import {
  claimGuestWorkspaceAndCreateSession,
  githubOAuthConfig,
} from "@/db/auth";
import { readCookie, workspaceCookie, workspaceForRequest } from "@/db/http";
import {
  expireCookie,
  hashSessionToken,
  createAccountWorkspaceId,
  OAUTH_PKCE_COOKIE,
  OAUTH_STATE_COOKIE,
  parseGithubProfile,
  randomOpaqueToken,
  secureCookie,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  validateOAuthCallback,
  type GithubProfile,
} from "@/lib/auth-core";

const CALLBACK_PATH = "/api/auth/github/callback";

type UserRow = {
  id: string;
  workspace_id: string;
};

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const cookieHeader = request.headers.get("cookie") ?? "";
  const expectedState = readCookie(cookieHeader, OAUTH_STATE_COOKIE);
  const verifier = readCookie(cookieHeader, OAUTH_PKCE_COOKIE);
  const returnedState = requestUrl.searchParams.get("state");
  const credentials = validateOAuthCallback({
    expectedState,
    returnedState,
    verifier,
    code: requestUrl.searchParams.get("code"),
    providerError: requestUrl.searchParams.get("error"),
  });

  if (!credentials) {
    return authRedirect(request, "error");
  }

  try {
    const config = await githubOAuthConfig(request);
    const accessToken = await exchangeCode({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code: credentials.code,
      redirectUri: config.redirectUri,
      verifier: credentials.verifier,
    });
    const profile = await fetchGithubProfile(accessToken);
    const guestWorkspace = workspaceForRequest(request);
    const db = await ensureDatabase();
    const now = new Date();
    const nowIso = now.toISOString();
    // Account workspaces use a separate namespace from UUID-shaped guest
    // cookies, so an account owner id can never be replayed as guest identity.
    const accountWorkspaceId = createAccountWorkspaceId();
    const userId = crypto.randomUUID();

    const user = await db
      .prepare(`
        INSERT INTO users (
          id, github_id, login, name, avatar_url, workspace_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(github_id) DO UPDATE SET
          login = excluded.login,
          name = excluded.name,
          avatar_url = excluded.avatar_url,
          updated_at = excluded.updated_at
        RETURNING id, workspace_id
      `)
      .bind(
        userId,
        profile.githubId,
        profile.login,
        profile.name,
        profile.avatarUrl,
        accountWorkspaceId,
        nowIso,
        nowIso,
      )
      .first<UserRow>();
    if (!user) throw new Error("GitHub user could not be persisted");

    const sessionToken = randomOpaqueToken(32);
    const tokenHash = await hashSessionToken(sessionToken);
    const expiresAt = new Date(
      now.getTime() + SESSION_MAX_AGE * 1_000,
    ).toISOString();
    const sessionId = crypto.randomUUID();

    // D1 batch statements commit atomically: project ownership never moves
    // unless the corresponding server-side session is created as well.
    const claimed = await claimGuestWorkspaceAndCreateSession({
      db,
      guestWorkspaceId: guestWorkspace.id,
      accountWorkspaceId: user.workspace_id,
      userId: user.id,
      sessionId,
      tokenHash,
      expiresAt,
      now: nowIso,
    });

    return authRedirect(request, "success", {
      claimed,
      sessionToken,
      rotatedWorkspaceId: crypto.randomUUID(),
    });
  } catch (error) {
    console.error(
      "GitHub OAuth callback failed",
      error instanceof Error ? error.message : "Unknown authentication error",
    );
    return authRedirect(request, "error");
  }
}

async function exchangeCode({
  clientId,
  clientSecret,
  code,
  redirectUri,
  verifier,
}: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  verifier: string;
}) {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  if (!response.ok) throw new Error(`GitHub token exchange returned ${response.status}`);
  const body = (await response.json()) as Record<string, unknown>;
  if (typeof body.access_token !== "string" || !body.access_token) {
    throw new Error("GitHub token exchange was rejected");
  }
  return body.access_token;
}

async function fetchGithubProfile(accessToken: string): Promise<GithubProfile> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "chance-atoms-demo",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GitHub profile request returned ${response.status}`);
  return parseGithubProfile(await response.json());
}

function authRedirect(
  request: Request,
  status: "success" | "error",
  success?: {
    claimed: number;
    sessionToken: string;
    rotatedWorkspaceId: string;
  },
) {
  const target = new URL("/", request.url);
  target.searchParams.set("auth", status);
  if (status === "success" && success) {
    target.searchParams.set("claimed", String(success.claimed));
  }
  const headers = new Headers({
    "Cache-Control": "no-store",
    Location: target.toString(),
  });
  headers.append(
    "Set-Cookie",
    expireCookie(request, OAUTH_STATE_COOKIE, CALLBACK_PATH),
  );
  headers.append(
    "Set-Cookie",
    expireCookie(request, OAUTH_PKCE_COOKIE, CALLBACK_PATH),
  );
  if (status === "success" && success) {
    headers.append(
      "Set-Cookie",
      secureCookie(request, SESSION_COOKIE, success.sessionToken, {
        maxAge: SESSION_MAX_AGE,
      }),
    );
    headers.append(
      "Set-Cookie",
      workspaceCookie(request, success.rotatedWorkspaceId),
    );
  }
  return new Response(null, { status: 302, headers });
}
