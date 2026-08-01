import { githubOAuthConfig } from "@/db/auth";
import {
  buildGithubAuthorizationUrl,
  createPkcePair,
  OAUTH_COOKIE_MAX_AGE,
  OAUTH_PKCE_COOKIE,
  OAUTH_STATE_COOKIE,
  randomOpaqueToken,
  secureCookie,
} from "@/lib/auth-core";

const CALLBACK_PATH = "/api/auth/github/callback";

export async function GET(request: Request) {
  try {
    const config = await githubOAuthConfig(request);
    const state = randomOpaqueToken(32);
    const { verifier, challenge } = await createPkcePair();
    const authorizeUrl = buildGithubAuthorizationUrl({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      state,
      codeChallenge: challenge,
    });
    const headers = new Headers({
      "Cache-Control": "no-store",
      Location: authorizeUrl.toString(),
    });
    headers.append(
      "Set-Cookie",
      secureCookie(request, OAUTH_STATE_COOKIE, state, {
        maxAge: OAUTH_COOKIE_MAX_AGE,
        path: CALLBACK_PATH,
      }),
    );
    headers.append(
      "Set-Cookie",
      secureCookie(request, OAUTH_PKCE_COOKIE, verifier, {
        maxAge: OAUTH_COOKIE_MAX_AGE,
        path: CALLBACK_PATH,
      }),
    );
    return new Response(null, { status: 302, headers });
  } catch (error) {
    console.error(
      "GitHub sign-in could not start",
      error instanceof Error ? error.message : "Unknown configuration error",
    );
    return Response.json(
      { error: "GitHub sign-in is not configured" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
