import { runIntegrityScan } from "@/lib/evidence";
import { authed, isUuid } from "@/lib/http";
import { invalid } from "@/lib/errors";

export const runtime = "nodejs";
export const maxDuration = 120;

export const POST = authed(async (request, user) => {
  const body = (await request.json().catch(() => ({}))) as { caseId?: unknown };
  if (body.caseId !== undefined && body.caseId !== null && !isUuid(body.caseId)) throw invalid("caseId must be a UUID");
  return runIntegrityScan(user, (body.caseId as string | undefined) ?? undefined);
});
