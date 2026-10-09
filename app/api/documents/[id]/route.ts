import { docChainTxs } from "@/lib/chain-feed";
import { getDocumentDetail } from "@/lib/evidence";
import { authed, requireUuid } from "@/lib/http";

export const runtime = "nodejs";

export const GET = authed(async (_request, user, p) => {
  const id = requireUuid(p.id, "document id");
  const detail = await getDocumentDetail(user, id);
  return { ...detail, chain: await docChainTxs(user, id) };
});
