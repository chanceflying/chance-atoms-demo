import { resolveIdentity } from "@/db/auth";
import { errorResponse, jsonResponse, workspaceForRequest } from "@/db/http";

export async function GET(request: Request) {
  const fallbackWorkspace = workspaceForRequest(request);
  try {
    const identity = await resolveIdentity(request);
    return jsonResponse(
      identity,
      { user: identity.user },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(fallbackWorkspace, error);
  }
}
