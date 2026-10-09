import { listAudit } from "@/lib/audit-query";
import { invalid } from "@/lib/errors";
import { authed, isUuid, pageArgs } from "@/lib/http";

export const runtime = "nodejs";

export const GET = authed(async (request, user) => {
  const url = new URL(request.url);
  const q = (k: string) => url.searchParams.get(k) ?? undefined;
  const docId = q("docId"), caseId = q("caseId");
  if ((docId && !isUuid(docId)) || (caseId && !isUuid(caseId))) throw invalid("docId / caseId must be UUIDs");
  return listAudit(user, { docId, caseId, action: q("action"), from: q("from"), to: q("to") }, pageArgs(url, 50, 200));
});
