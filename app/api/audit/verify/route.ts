import { verifyAuditChain } from "@/lib/audit-query";
import { authed } from "@/lib/http";

export const runtime = "nodejs";

export const POST = authed(async (_request, user) => verifyAuditChain(user));
