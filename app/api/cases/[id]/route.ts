import { getCaseDetail } from "@/lib/cases";
import { authed, requireUuid } from "@/lib/http";

export const runtime = "nodejs";

export const GET = authed(async (_request, user, p) => getCaseDetail(user, requireUuid(p.id, "case id")));
