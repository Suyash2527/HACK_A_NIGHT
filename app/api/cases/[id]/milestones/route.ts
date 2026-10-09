import { addMilestone } from "@/lib/cases";
import { authed, jsonBody, optStr, requireUuid, str } from "@/lib/http";
import type { CaseStage } from "@/types/api";

export const runtime = "nodejs";

export const POST = authed(async (request, user, p) => {
  const body = await jsonBody(request);
  return addMilestone(user, requireUuid(p.id, "case id"), str(body.stage, "stage", 40) as CaseStage, optStr(body.note, "note", 500));
});
