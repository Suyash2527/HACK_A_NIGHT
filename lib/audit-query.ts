// SERVER-ONLY read side of the audit log: the explorer (court), policy-filtered custody for a document, and chain verification.
import { AUDIT_ACTIONS, type AuditAction, type AuditChainResult, type AuditEntry, type LegalBasis, type Role } from "@/types/api";
import { logDenied } from "./audit";
import { getDb, type Row } from "./db";
import { forbidden, invalid, notFound } from "./errors";
import { pageOf, type PageArgs } from "./http";
import { canVerifyAuditChain, isCourt } from "./policy";
import type { SessionUser } from "./session";

const iso = (v: unknown) => new Date(v as string).toISOString();

export interface AuditFilter { docId?: string; caseId?: string; action?: string; from?: string; to?: string }

const toEntry = (r: Row): AuditEntry => ({
  id: r.id, seq: Number(r.seq), actorName: r.actor_name, role: r.actor_role as Role, action: r.action as AuditAction,
  docId: r.doc_id ?? null, caseId: r.case_id ?? null, at: iso(r.at), prevHash: r.prev_hash, entryHash: r.entry_hash,
  legalBasis: r.legal_basis as LegalBasis, detail: r.detail ?? null,
});

function date(v: string | undefined, what: string): string | undefined {
  if (!v) return undefined;
  if (Number.isNaN(Date.parse(v))) throw invalid(`${what} must be an ISO-8601 date`);
  return new Date(v).toISOString();
}

/**
 * Court roles may explore everything. Everyone else only gets the custody trail of ONE document they can read
 * (RLS additionally limits rows to their own actions or cases they are assigned to).
 */
export async function listAudit(user: SessionUser, f: AuditFilter, a: PageArgs) {
  if (f.action && !(AUDIT_ACTIONS as readonly string[]).includes(f.action)) throw invalid("Unknown audit action");
  const from = date(f.from, "from"), to = date(f.to, "to");
  const db = await getDb();
  if (!isCourt(user.role) && !f.docId) {
    await logDenied(user.id, "audit explorer refused: only the court may browse the whole log");
    throw forbidden("Only the court can browse the audit log; request a specific document's custody trail");
  }
  return db.withUser(user.id, async (tx) => {
    if (!isCourt(user.role) && f.docId) {
      const visible = (await tx.query("SELECT 1 FROM documents WHERE id = $1", [f.docId])).rowCount > 0;
      if (!visible) throw notFound("Document unavailable");
    }
    const where: string[] = []; const p: unknown[] = [];
    const add = (sql: string, v: unknown) => { p.push(v); where.push(sql.replace("?", `$${p.length}`)); };
    if (f.docId) add("a.doc_id = ?", f.docId);
    if (f.caseId) add("a.case_id = ?", f.caseId);
    if (f.action) add("a.action = ?::audit_action", f.action);
    if (from) add("a.at >= ?::timestamptz", from);
    if (to) add("a.at <= ?::timestamptz", to);
    p.push(a.limit + 1, a.offset);
    const rows = (await tx.query(
      `SELECT a.*, u.name AS actor_name, u.role AS actor_role FROM audit_log a JOIN users u ON u.id = a.actor_id
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY a.seq DESC LIMIT $${p.length - 1} OFFSET $${p.length}`, p)).rows;
    return pageOf(rows.slice(0, a.limit).map(toEntry), rows.length > a.limit, a);
  });
}

/** Court-only recomputation of the whole hash chain inside the database, plus a check against the last anchored batch. */
export async function verifyAuditChain(user: SessionUser): Promise<AuditChainResult> {
  if (!canVerifyAuditChain(user.role)) { await logDenied(user.id, "audit chain verification refused: court roles only"); throw forbidden("Only the court can verify the audit chain"); }
  const db = await getDb();
  return db.withUser(user.id, async (tx) => {
    const r = (await tx.query<{ checked: string; first_broken_id: string | null; head_hash: string | null }>("SELECT * FROM verify_audit_chain()")).rows[0];
    // headAnchored: the most recent anchored batch committed to an audit head; that entry must still be exactly what the batch recorded
    const b = (await tx.query<{ audit_seq: string; audit_head: string }>(
      "SELECT audit_seq, audit_head FROM merkle_batches WHERE tx_hash IS NOT NULL AND audit_seq IS NOT NULL ORDER BY id DESC LIMIT 1")).rows[0];
    let anchored = false;
    if (b) anchored = (await tx.query("SELECT 1 FROM audit_log WHERE seq = $1 AND entry_hash = $2", [b.audit_seq, b.audit_head])).rowCount > 0;
    return {
      status: r.first_broken_id === null ? "pass" : "fail", checkedEntries: Number(r.checked), checkedAt: new Date().toISOString(),
      firstBrokenEntryId: r.first_broken_id, headHash: r.head_hash, headAnchored: anchored,
    };
  });
}
