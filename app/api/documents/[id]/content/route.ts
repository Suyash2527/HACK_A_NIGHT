import { readContent } from "@/lib/evidence";
import { authed, requireUuid } from "@/lib/http";
import { invalid } from "@/lib/errors";
import { watermark } from "@/lib/watermark";

export const runtime = "nodejs";

const asciiName = (n: string) => n.replace(/[^\x20-\x7e]|["\\]/g, "_");

export const GET = authed(async (request, user, p) => {
  const d = new URL(request.url).searchParams.get("disposition") ?? "inline";
  if (d !== "inline" && d !== "attachment") throw invalid("disposition must be inline or attachment");
  const out = await readContent(user, requireUuid(p.id, "document id"), d);
  let body: Buffer = out.bytes, filename = out.filename;
  const extra: Record<string, string> = {};
  if (user.role === "DEFENCE_ADVOCATE") {
    // court-granted copies are marked with the advocate, the order and the document hash
    const orderRef = out.orderRef ?? "UNKNOWN";
    const w = watermark(out, user.name, orderRef);
    body = w.bytes; filename = w.filename; Object.assign(extra, w.headers);
  }
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": out.mimeType,
      "Content-Length": String(body.length),
      "Content-Disposition": `${d}; filename="${asciiName(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Sakshya-Sha256": out.sha256,
      "X-Sakshya-Verification": out.verification.status,
      ...extra,
    },
  });
});
