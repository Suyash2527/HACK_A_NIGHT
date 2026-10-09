// SERVER-ONLY. Court-granted copies handed to a DEFENCE_ADVOCATE are marked so a leaked copy is traceable to its order.
// Honest scope: plain-text files get the stamp written INTO the content; PDFs, Word files and images are left byte-identical
// (so their hash still matches) and the stamp travels in the download file name and the X-Sakshya-Watermark header only.
import { watermarkLine } from "./policy";

export interface Marked { bytes: Buffer; filename: string; headers: Record<string, string>; embedded: boolean }

export function watermark(file: { bytes: Buffer; filename: string; mimeType: string; sha256: string }, advocate: string, orderRef: string, at = new Date()): Marked {
  const line = watermarkLine(advocate, orderRef, file.sha256, at);
  const safeRef = orderRef.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 40);
  const filename = `granted-${safeRef}_${file.filename}`;
  const headers = { "X-Sakshya-Watermark": encodeURIComponent(line), "X-Sakshya-Watermark-Mode": file.mimeType === "text/plain" ? "embedded" : "filename-and-header-only" };
  if (file.mimeType === "text/plain")
    return { bytes: Buffer.concat([Buffer.from(`${line}\n${"-".repeat(40)}\n`, "utf8"), file.bytes]), filename, headers, embedded: true };
  return { bytes: file.bytes, filename, headers, embedded: false };
}
