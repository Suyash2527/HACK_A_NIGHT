import { ALLOWED_UPLOAD_MIME, MAX_UPLOAD_BYTES, type DocType } from "@/types/api";
import { invalid, tooLarge } from "@/lib/errors";
import { uploadDocument, listCaseDocuments } from "@/lib/evidence";
import { authed, isUuid, optStr, pageArgs, pageOf } from "@/lib/http";

export const runtime = "nodejs";

const DOC_TYPES: DocType[] = ["FIR", "WITNESS_STATEMENT", "FORENSIC_REPORT", "CHARGE_SHEET"];
const EXT_MIME: Record<string, string> = Object.fromEntries(Object.entries(ALLOWED_UPLOAD_MIME).map(([m, e]) => [e, m]));

export const GET = authed(async (request, user) => {
  const url = new URL(request.url);
  const caseId = url.searchParams.get("caseId");
  if (!isUuid(caseId)) throw invalid("caseId is required");
  const a = pageArgs(url);
  const all = await listCaseDocuments(user, caseId);
  return pageOf(all.slice(a.offset, a.offset + a.limit), all.length > a.offset + a.limit, a);
});

export const POST = authed(async (request, user) => {
  // refuse oversized bodies BEFORE buffering them
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) throw tooLarge();
  const form = await request.formData().catch(() => { throw invalid("Expected multipart/form-data"); });
  const file = form.get("file");
  if (!(file instanceof File)) throw invalid("file is required");
  if (file.size > MAX_UPLOAD_BYTES) throw tooLarge();
  const caseId = form.get("caseId"), type = form.get("type");
  if (!isUuid(caseId)) throw invalid("caseId is required");
  if (typeof type !== "string" || !DOC_TYPES.includes(type as DocType)) throw invalid("type must be one of " + DOC_TYPES.join(", "));
  const parentId = optStr(form.get("parentId"), "parentId", 40);
  if (parentId && !isUuid(parentId)) throw invalid("parentId must be a UUID");
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  const mimeType = file.type && file.type !== "application/octet-stream" ? file.type : EXT_MIME[ext === ".jpeg" ? ".jpg" : ext] ?? file.type;
  const receipt = await uploadDocument(user, { caseId: caseId.toLowerCase(), type: type as DocType, filename: file.name, mimeType, bytes: new Uint8Array(await file.arrayBuffer()), parentId: parentId ?? null });
  return Response.json(receipt, { status: 201, headers: { "Cache-Control": "no-store" } });
});
