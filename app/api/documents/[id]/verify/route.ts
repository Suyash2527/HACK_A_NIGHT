import { verifyDocumentById } from "@/lib/evidence";
import { authed, requireUuid } from "@/lib/http";

export const runtime = "nodejs";

export const POST = authed(async (_request, user, p) => verifyDocumentById(user, requireUuid(p.id, "document id")));
