import { ensureDatabase } from "@/db";
import { sessionTokenForRequest } from "@/db/auth";
import { errorResponse, jsonResponse, workspaceForRequest } from "@/db/http";
import {
  expireCookie,
  hashSessionToken,
  isSameOriginRequest,
  SESSION_COOKIE,
} from "@/lib/auth-core";

export async function POST(request: Request) {
  const workspace = workspaceForRequest(request);
  if (!isSameOriginRequest(request)) {
    return jsonResponse(
      workspace,
      { error: "Cross-origin logout is not allowed" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const token = sessionTokenForRequest(request);
    if (token && /^[A-Za-z0-9_-]{32,256}$/.test(token)) {
      const db = await ensureDatabase();
      await db
        .prepare(`
          UPDATE sessions
          SET revoked_at = ?
          WHERE token_hash = ? AND revoked_at IS NULL
        `)
        .bind(new Date().toISOString(), await hashSessionToken(token))
        .run();
    }

    workspace.additionalSetCookies = [
      ...(workspace.additionalSetCookies ?? []),
      expireCookie(request, SESSION_COOKIE),
    ];
    return jsonResponse(
      workspace,
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(workspace, error);
  }
}
