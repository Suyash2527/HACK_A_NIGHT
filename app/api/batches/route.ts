import { listBatches } from "@/lib/anchoring";
import { authed, pageArgs } from "@/lib/http";

export const runtime = "nodejs";

export const GET = authed(async (request, user) => listBatches(user, pageArgs(new URL(request.url))));
