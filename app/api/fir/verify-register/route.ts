import { verifyFirRegister } from "@/lib/cases";
import { authed } from "@/lib/http";

export const runtime = "nodejs";

export const POST = authed(async (_request, user) => verifyFirRegister(user));
