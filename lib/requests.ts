// SERVER-ONLY advocate document requests and the judge's decision. A GRANT becomes per-document, time-limited access
// (rows in request_grants created by a database trigger); the advocate's later reads are audited under the court-order basis.
import {
  type CaseStage, type DecideRequestBody, type DocType, type DocumentRequest, type FileRequestBody, type LegalBasis, type RequestCatalog,
  type RequestStatus, type Role,
} from "@/types/api";
import { courtOrderBasis, defaultBasis, logDenied, writeAudit } from "./audit";
import { getChain } from "./chain";
import { getDb, type Row } from "./db";
import { forbidden, invalid, notFound } from "./errors";
import { isUuid, pageOf, type PageArgs } from "./http";
import { canDecideRequests, canFileRequests, isCourt } from "./policy";
import type { SessionUser } from "./session";

const iso = (v: unknown) => new Date(v as string).toISOString();
const STATUSES: RequestStatus[] = ["PENDING", "GRANTED", "REJECTED", "EXPIRED"];

/** Titles only — never content, hashes or custody (see RequestCatalog). */
export async function lookupCatalog(user: SessionUser, firNo: string): Promise<RequestCatalog> {
  if (!canFileRequests(user.role) && !isCourt(user.role)) { await logDenied(user.id, "document catalog refused: advocates and the court only"); throw forbidden("Only advocates and the court can look up a case's document list"); }
  const db = await getDb();
  const rows = (await (await db.withUser(user.id, (tx) => tx.query("SELECT * FROM request_catalog($1)", [firNo.trim().toUpperCase()]))).rows) as Row[];
  if (!rows.length) throw notFound("No case found for that FIR number");
  return {
    caseId: rows[0].case_id, firNo: rows[0].fir_no, station: rows[0].station, stage: rows[0].stage as CaseStage,
    documents: rows.map((r) => ({ id: r.doc_id, type: r.doc_type as DocType, filename: r.filename, version: Number(r.version), createdAt: iso(r.created_at) })),
  };
}

const SELECT_REQUEST = `
  SELECT r.id, r.case_id, r.document_ids, r.legal_basis, r.reason, r.filed_at, request_case_fir(r.case_id) AS fir_no,
         ru.id AS req_id, ru.name AS req_name, ru.role AS req_role,
         d.decision, d.order_ref, d.note, d.granted_document_ids, d.expires_at, d.decided_at, du.id AS dec_id, du.name AS dec_name,
         CASE WHEN d.request_id IS NULL THEN 'PENDING'
              WHEN d.decision = 'REJECT' THEN 'REJECTED'
              WHEN d.expires_at IS NOT NULL AND d.expires_at <= now() THEN 'EXPIRED'
              ELSE 'GRANTED' END AS status
    FROM document_requests r
    JOIN users ru ON ru.id = r.requester_id
    LEFT JOIN request_decisions d ON d.request_id = r.id
    LEFT JOIN users du ON du.id = d.decided_by`;

function toRequest(r: Row): DocumentRequest {
  return {
    id: r.id, caseId: r.case_id, firNo: r.fir_no ?? "", requester: { id: r.req_id, name: r.req_name, role: r.req_role as Role },
    documentIds: r.document_ids, legalBasis: r.legal_basis as LegalBasis, reason: r.reason, status: r.status as RequestStatus, filedAt: iso(r.filed_at),
    decision: r.decision ? {
      by: { id: r.dec_id, name: r.dec_name }, at: iso(r.decided_at), orderRef: r.order_ref, note: r.note,
      grantedDocumentIds: r.granted_document_ids ?? [], permission: "VIEW_AND_WATERMARKED_DOWNLOAD", expiresAt: r.expires_at ? iso(r.expires_at) : null,
    } : null,
  };
}

export async function fileRequest(user: SessionUser, body: FileRequestBody): Promise<DocumentRequest> {
  if (!canFileRequests(user.role)) { await logDenied(user.id, "document request refused: advocates only"); throw forbidden("Only a defence advocate can file a document request"); }
  const { caseId, documentIds, legalBasis, reason } = body;
  if (!isUuid(caseId)) throw invalid("caseId must be a UUID");
  if (!Array.isArray(documentIds) || documentIds.length < 1 || documentIds.length > 50 || !documentIds.every(isUuid)) throw invalid("documentIds must list 1–50 document UUIDs");
  if (!legalBasis || (legalBasis.code !== "STATUTORY_DISCLOSURE" && legalBasis.code !== "COURT_ORDER")) throw invalid("legalBasis.code must be STATUTORY_DISCLOSURE or COURT_ORDER");
  const citation = typeof legalBasis.citation === "string" ? legalBasis.citation.trim() : "";
  if (!citation) throw invalid("A legal citation is required (for example BNSS 2023 s.230)");
  if (typeof reason !== "string" || !reason.trim()) throw invalid("A reason is required");
  const basis: LegalBasis = { code: legalBasis.code, citation: citation.slice(0, 300), orderRef: legalBasis.code === "COURT_ORDER" ? citation.slice(0, 300) : null };
  const ids = [...new Set(documentIds.map((d) => d.toLowerCase()))];

  const db = await getDb();
  const id = await db.withUser(user.id, async (tx) => {
    const ok = (await tx.query<{ ok: boolean }>("SELECT request_validate($1, $2::uuid[]) AS ok", [caseId, ids])).rows[0]?.ok;
    if (!ok) throw invalid("Every requested document must exist in the stated case");
    const row = (await tx.query<{ id: string }>(
      "INSERT INTO document_requests (case_id, requester_id, document_ids, legal_basis, reason) VALUES ($1,$2,$3::uuid[],$4::jsonb,$5) RETURNING id",
      [caseId, user.id, ids, JSON.stringify(basis), reason.trim().slice(0, 2000)])).rows[0];
    await writeAudit(tx, { actorId: user.id, action: "REQUEST_FILED", caseId, basis, detail: `request ${row.id}: ${ids.length} document(s)` });
    return row.id;
  });
  return getRequest(user, id);
}

async function getRequest(user: SessionUser, id: string): Promise<DocumentRequest> {
  const db = await getDb();
  const r = await db.withUser(user.id, async (tx) => (await tx.query(`${SELECT_REQUEST} WHERE r.id = $1`, [id])).rows[0]);
  if (!r) throw notFound("Request unavailable");
  return toRequest(r);
}

/** Court roles see every request; an advocate sees their own (row-level security). Newest first. */
export async function listRequests(user: SessionUser, f: { caseId?: string; status?: string }, a: PageArgs) {
  if (f.status && !STATUSES.includes(f.status as RequestStatus)) throw invalid("Unknown status");
  if (!isCourt(user.role) && !canFileRequests(user.role)) { await logDenied(user.id, "request list refused"); throw forbidden("You cannot list document requests"); }
  const db = await getDb();
  return db.withUser(user.id, async (tx) => {
    const p: unknown[] = []; const where: string[] = [];
    if (f.caseId) { p.push(f.caseId); where.push(`r.case_id = $${p.length}`); }
    p.push(a.limit + 1, a.offset);
    const rows = (await tx.query(`SELECT * FROM (${SELECT_REQUEST} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}) q
      ${f.status ? `WHERE q.status = '${f.status}'` : ""} ORDER BY q.filed_at DESC, q.id LIMIT $${p.length - 1} OFFSET $${p.length}`, p)).rows;
    return pageOf(rows.slice(0, a.limit).map(toRequest), rows.length > a.limit, a);
  });
}

export async function decideRequest(user: SessionUser, requestId: string, body: DecideRequestBody): Promise<DocumentRequest> {
  if (!canDecideRequests(user.role)) { await logDenied(user.id, "request decision refused: judges only"); throw forbidden("Only a judge can decide a document request"); }
  if (body.decision !== "GRANT" && body.decision !== "REJECT") throw invalid("decision must be GRANT or REJECT");
  const orderRef = typeof body.orderRef === "string" ? body.orderRef.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!orderRef) throw invalid("A court order reference is required");
  if (!note) throw invalid("A note recording the reasons is required");
  let expires: string | null = null;
  if (body.expiresAt) {
    const t = Date.parse(body.expiresAt);
    if (Number.isNaN(t) || t <= Date.now()) throw invalid("expiresAt must be a future date");
    expires = new Date(t).toISOString();
  }

  const db = await getDb();
  const res = await db.withUser(user.id, async (tx) => {
    const req = (await tx.query<Row>("SELECT id, case_id, document_ids, legal_basis FROM document_requests WHERE id = $1", [requestId])).rows[0];
    if (!req) throw notFound("Request unavailable");
    if ((await tx.query("SELECT 1 FROM request_decisions WHERE request_id = $1", [requestId])).rowCount > 0) throw invalid("This request has already been decided");
    let granted: string[] = [];
    if (body.decision === "GRANT") {
      granted = (body.grantedDocumentIds?.length ? body.grantedDocumentIds : req.document_ids) as string[];
      if (!granted.every(isUuid) || !granted.every((g) => (req.document_ids as string[]).includes(g.toLowerCase()))) throw invalid("grantedDocumentIds must be a subset of the requested documents");
      granted = [...new Set(granted.map((g) => g.toLowerCase()))];
    }
    await tx.query("INSERT INTO request_decisions (request_id, decided_by, decision, order_ref, note, granted_document_ids, expires_at) VALUES ($1,$2,$3,$4,$5,$6::uuid[],$7)",
      [requestId, user.id, body.decision, orderRef.slice(0, 200), note.slice(0, 2000), granted, expires]);
    const basis = body.decision === "GRANT" ? courtOrderBasis(((req.legal_basis as LegalBasis).citation ?? "court order").slice(0, 300), orderRef.slice(0, 200)) : defaultBasis(user.role);
    const entry = await writeAudit(tx, { actorId: user.id, action: body.decision === "GRANT" ? "REQUEST_GRANTED" : "REQUEST_REJECTED", caseId: req.case_id, basis,
      detail: `request ${requestId}: order ${orderRef}${body.decision === "GRANT" ? `, ${granted.length} document(s)${expires ? `, until ${expires}` : ""}` : ""}` });
    return { caseId: req.case_id as string, entryHash: entry.entryHash };
  });
  const chain = await getChain();
  if (chain) void chain.auditEvent({ subject: { caseId: res.caseId }, action: body.decision === "GRANT" ? "REQUEST_GRANTED" : "REQUEST_REJECTED", actorId: user.id, entryHash: res.entryHash,
    label: `Court ${body.decision === "GRANT" ? "granted" : "rejected"} a document request (order ${orderRef})` });
  return getRequest(user, requestId);
}
