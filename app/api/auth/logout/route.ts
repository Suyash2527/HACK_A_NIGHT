import { clearedCookie } from "@/lib/session";

export const runtime = "nodejs";

export async function POST() {
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearedCookie(), "Cache-Control": "no-store" } });
}
