import { demoAttackEnabled, insiderAttack } from "@/lib/demo-attack";
import { logDenied } from "@/lib/audit";
import { forbidden, invalid, notFound } from "@/lib/errors";
import { authed, jsonBody, requireUuid } from "@/lib/http";

export const runtime = "nodejs";

// Rehearsal tool, not a product feature: simulates an insider with storage access. It is invisible (404) unless the server
// is started with SAKSHYA_DEMO_ATTACK=1, and then only an ADMIN may call it. It deliberately bypasses the application, so the
// application's own audit log never sees the write — detection comes from verification, which is the point of the demo.
export const POST = authed(async (request, user) => {
  if (!demoAttackEnabled()) throw notFound("Not found");
  if (user.role !== "ADMIN") { await logDenied(user.id, "demo attack refused: ADMIN only"); throw forbidden("Only an administrator can run the demo attack"); }
  const body = await jsonBody(request);
  const offset = body.offset === undefined ? undefined : Number(body.offset);
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) throw invalid("offset must be a non-negative integer");
  console.warn(`[demo-attack] ${user.email} tampering with ${String(body.docId)}`);
  return insiderAttack(requireUuid(body.docId, "docId"), offset);
});
