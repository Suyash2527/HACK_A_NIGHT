import { assembleCase } from "@/lib/assembly";
import { authed, requireUuid } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 120;

export const POST = authed(async (_request, user, p) => assembleCase(user, requireUuid(p.id, "case id")));
