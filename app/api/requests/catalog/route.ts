import { lookupCatalog } from "@/lib/requests";
import { authed, str } from "@/lib/http";

export const runtime = "nodejs";

export const GET = authed(async (request, user) => lookupCatalog(user, str(new URL(request.url).searchParams.get("firNo"), "firNo", 40)));
