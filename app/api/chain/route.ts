import { chainInfo } from "@/lib/chain-feed";
import { authed } from "@/lib/http";

export const runtime = "nodejs";

export const GET = authed(async () => chainInfo());
