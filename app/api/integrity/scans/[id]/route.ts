import { getIntegrityScan } from "@/lib/evidence";
import { authed, requireUuid } from "@/lib/http";

export const runtime = "nodejs";

export const GET = authed(async (_request, user, p) => getIntegrityScan(user, requireUuid(p.id, "scan id")));
