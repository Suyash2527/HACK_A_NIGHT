import { restoreDocument } from "@/lib/evidence";
import { authed, jsonBody, requireUuid, str } from "@/lib/http";

export const runtime = "nodejs";

export const POST = authed(async (request, user, p) => {
  const body = await jsonBody(request);
  const receipt = await restoreDocument(user, requireUuid(p.id, "document id"), str(body.reason, "reason", 500));
  return Response.json(receipt, { status: 201, headers: { "Cache-Control": "no-store" } });
});
