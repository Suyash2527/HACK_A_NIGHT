import { downloadBundle } from "@/lib/assembly";
import { authed, requireUuid, str } from "@/lib/http";

export const runtime = "nodejs";

export const GET = authed(async (request, user, p) => {
  const b = await downloadBundle(user, requireUuid(p.id, "case id"), str(new URL(request.url).searchParams.get("token"), "token", 100));
  return new Response(new Uint8Array(b.bytes), {
    headers: {
      "Content-Type": "application/zip", "Content-Length": String(b.bytes.length), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `attachment; filename="${b.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`, "X-Sakshya-Sha256": b.sha256,
    },
  });
});
