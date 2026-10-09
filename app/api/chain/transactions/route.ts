import { chainTransactions } from "@/lib/chain-feed";
import { authed, isUuid } from "@/lib/http";
import { invalid } from "@/lib/errors";

export const runtime = "nodejs";

export const GET = authed(async (request, user) => {
  const url = new URL(request.url);
  const docId = url.searchParams.get("docId") ?? undefined, caseId = url.searchParams.get("caseId") ?? undefined;
  if ((docId && !isUuid(docId)) || (caseId && !isUuid(caseId))) throw invalid("docId / caseId must be UUIDs");
  return chainTransactions(user, url, { docId, caseId });
});
