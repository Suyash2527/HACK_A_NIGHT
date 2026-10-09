import { errorResponse } from "@/lib/errors";
import { requireUser, toSession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    return Response.json(toSession(await requireUser(request)), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
