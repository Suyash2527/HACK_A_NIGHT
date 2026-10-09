// SERVER-ONLY case service: listing, FIR registration/checking, detail, complainant progress, milestones.
// RLS decides what a caller can see; an empty result is therefore always treated as not-found/denied.
import {
  CASE_STAGES, ROLE_UPLOAD_TYPES,
  type CaseDetail, type CaseManifest, type CaseProgress, type CaseStage, type CaseSummary, type FirCheck, type FirRegisterResult, type IntegrityCounts,
  type Milestone, type Role, type VerifyStatus,
} from "@/types/api";
import { defaultBasis, logDenied, writeAudit } from "./audit";
import { getChain } from "./chain";
import { explorerFor } from "./chain-feed";
import { getDb, type Row, type Tx } from "./db";
import { forbidden, invalid, notFound, requireRows } from "./errors";
import { pageOf, type PageArgs } from "./http";
import { canAddMilestone, isCourt } from "./policy";
import type { SessionUser } from "./session";

const iso = (v: unknown) => new Date(v as string).toISOString();
const VERIFY_STATUSES: VerifyStatus[] = ["VERIFIED", "TAMPERED", "PENDING_ANCHOR", "UNANCHORED", "ERROR"];
const emptyCounts = (): IntegrityCounts => ({ VERIFIED: 0, TAMPERED: 0, PENDING_ANCHOR: 0, UNANCHORED: 0, ERROR: 0, unchecked: 0 });

/** Latest integrity status per visible document, grouped per case. */
async function integrityFor(tx: Tx, caseIds: string[]): Promise<Map<string, { total: number; counts: IntegrityCounts }>> {
  const out = new Map<string, { total: number; counts: IntegrityCounts }>();
  for (const id of caseIds) out.set(id, { total: 0, counts: emptyCounts() });
  if (!caseIds.length) return out;
  const rows = (await tx.query<{ case_id: string; status: string | null; n: string }>(
    `SELECT d.case_id, l.status, count(*) AS n
       FROM documents d
       LEFT JOIN LATERAL (SELECT v.status FROM verification_results v WHERE v.doc_id = d.id ORDER BY v.at DESC, v.id DESC LIMIT 1) l ON true
      WHERE d.case_id = ANY($1::uuid[]) GROUP BY d.case_id, l.status`, [caseIds])).rows;
  for (const r of rows) {
    const e = out.get(r.case_id)!;
    e.total += Number(r.n);
    if (r.status && (VERIFY_STATUSES as string[]).includes(r.status)) e.counts[r.status as VerifyStatus] += Number(r.n);
    else e.counts.unchecked += Number(r.n);
  }
  return out;
}

const summaryOf = (r: Row, i: { total: number; counts: IntegrityCounts }): CaseSummary => ({
  id: r.id, firNo: r.fir_no, station: r.station, stage: r.stage as CaseStage, status: r.status, createdAt: iso(r.created_at),
  documentCount: i.total, integrity: i.counts,
});

export async function listCases(user: SessionUser, q: string | undefined, a: PageArgs) {
  const db = await getDb();
  return db.withUser(user.id, async (tx) => {
    const params: unknown[] = [];
    let where = "";
    if (q && q.trim()) { params.push(`%${q.trim().replace(/[%_\\]/g, "\\$&")}%`); where = `WHERE c.fir_no ILIKE $1 OR c.station ILIKE $1`; }
    params.push(a.limit + 1, a.offset);
    const rows = (await tx.query(`SELECT c.* FROM cases c ${where} ORDER BY c.created_at DESC, c.id LIMIT $${params.length - 1} OFFSET $${params.length}`, params)).rows;
    const page = rows.slice(0, a.limit);
    const integ = await integrityFor(tx, page.map((r) => r.id));
    return pageOf(page.map((r) => summaryOf(r, integ.get(r.id)!)), rows.length > a.limit, a);
  });
}

// ───────────────────────────── detail
async function manifestOf(tx: Tx, caseId: string, firNo: string): Promise<CaseManifest | null> {
  const m = (await tx.query("SELECT version, root, doc_count, created_at FROM case_manifests WHERE case_id = $1 ORDER BY version DESC LIMIT 1", [caseId])).rows[0];
  if (!m) return null;
  // the SEAL_MANIFEST chain tx for this version carries the version in its label
  const t = (await tx.query("SELECT tx_hash, chain_id, status FROM chain_txs WHERE case_id = $1 AND kind = 'SEAL_MANIFEST' AND label LIKE $2 ORDER BY created_at DESC LIMIT 1",
    [caseId, `Sealed case folder ${firNo} version ${m.version} (%`])).rows[0];
  return {
    version: Number(m.version), root: m.root, documentCount: Number(m.doc_count), sealedAt: iso(m.created_at),
    anchor: t ? { txHash: t.tx_hash, explorerUrl: explorerFor(t.chain_id, t.tx_hash), status: t.status === "confirmed" ? "confirmed" : "pending" } : null,
  };
}

export async function getCaseDetail(user: SessionUser, caseId: string): Promise<CaseDetail> {
  const db = await getDb();
  const detail = await db.withUser(user.id, async (tx) => {
    const c = (await tx.query("SELECT * FROM cases WHERE id = $1", [caseId])).rows[0];
    if (!c) return null;
    const integ = (await integrityFor(tx, [caseId])).get(caseId)!;
    const assignments = (await tx.query<{ name: string; role: Role }>(
      "SELECT u.name, a.role FROM case_assignments a JOIN users u ON u.id = a.user_id WHERE a.case_id = $1 ORDER BY u.name", [caseId])).rows;
    const assigned = (await tx.query("SELECT 1 FROM case_assignments WHERE case_id = $1 AND user_id = app_uid()", [caseId])).rowCount > 0;
    const grant = user.role === "DEFENCE_ADVOCATE" && (await tx.query("SELECT 1 FROM request_grants g JOIN documents d ON d.id = g.document_id WHERE d.case_id = $1 AND g.user_id = app_uid() AND (g.expires_at IS NULL OR g.expires_at > now()) LIMIT 1", [caseId])).rowCount > 0;
    const allowed = assigned ? [...ROLE_UPLOAD_TYPES[user.role]] : [];
    const canAssemble = isCourt(user.role) || (user.role === "PUBLIC_PROSECUTOR" && assigned) || grant;
    return {
      ...summaryOf(c, integ),
      allowedUploadTypes: allowed, canUpload: allowed.length > 0,
      assignments: assignments.map((x) => ({ userName: x.name, role: x.role })),
      manifest: user.role === "COMPLAINANT" || user.role === "DEFENCE_ADVOCATE" ? null : await manifestOf(tx, caseId, c.fir_no),
      canAssemble, canRequestDocuments: user.role === "DEFENCE_ADVOCATE",
    } satisfies CaseDetail;
  });
  if (!detail) {
    await logDenied(user.id, "case not accessible", { caseId });
    throw notFound("Case unavailable");
  }
  return detail;
}

// ───────────────────────────── registration (the FIR number is assigned by the database, never typed)
export async function createCase(user: SessionUser, complainantEmail?: string): Promise<CaseDetail> {
  if (user.role !== "POLICE") { await logDenied(user.id, "case registration refused: only POLICE may register a case"); throw forbidden("Only police may register a case"); }
  const db = await getDb();
  const caseId = await db.withUser(user.id, async (tx) => {
    let complainant: string | null = null;
    if (complainantEmail) {
      const u = (await tx.query<{ id: string; role: Role }>("SELECT id, role FROM users WHERE lower(email) = lower($1)", [complainantEmail.trim()])).rows[0];
      if (!u || u.role !== "COMPLAINANT") throw invalid("No complainant account exists for that email");
      complainant = u.id;
    }
    const row = requireRows((await tx.query<{ case_id: string; fir_no: string }>("SELECT case_id, fir_no FROM create_case($1)", [complainant])).rows, "Case");
    await writeAudit(tx, { actorId: user.id, action: "MILESTONE_ADDED", caseId: row[0].case_id, basis: defaultBasis(user.role), detail: `FIR registered: ${row[0].fir_no}` });
    return row[0].case_id;
  });
  return getCaseDetail(user, caseId);
}

/** Any signed-in user may ask whether an FIR number is genuine (SECURITY DEFINER function; reveals only genuineness, station and issue time). */
export async function checkFir(user: SessionUser, firNo: string): Promise<FirCheck> {
  const db = await getDb();
  const n = firNo.trim().toUpperCase();
  return db.withUser(user.id, async (tx) => {
    const row = (await tx.query<{ genuine: boolean; issued_at: string | null; station_code: string | null }>("SELECT * FROM check_fir_number($1)", [n])).rows[0];
    const genuine = Boolean(row?.genuine);
    return { firNo: n, genuine, stationCode: genuine ? row.station_code : null, issuedAt: genuine && row.issued_at ? iso(row.issued_at) : null };
  });
}

export async function verifyFirRegister(user: SessionUser): Promise<FirRegisterResult> {
  if (!isCourt(user.role)) { await logDenied(user.id, "FIR register verification refused: court roles only"); throw forbidden("Only the court can verify the FIR register"); }
  const db = await getDb();
  return db.withUser(user.id, async (tx) => {
    const r = (await tx.query<{ checked: string; first_broken_seq: string | null; problem: string | null }>("SELECT * FROM verify_fir_register()")).rows[0];
    return { status: r.first_broken_seq === null ? "pass" : "fail", checkedEntries: Number(r.checked), checkedAt: new Date().toISOString(),
      firstBrokenSeq: r.first_broken_seq === null ? null : Number(r.first_broken_seq), problem: r.problem };
  });
}

// ───────────────────────────── complainant progress / milestones (never any document data)
export async function getProgress(user: SessionUser, caseId: string): Promise<CaseProgress> {
  const db = await getDb();
  const out = await db.withUser(user.id, async (tx) => {
    const c = (await tx.query("SELECT id, fir_no, station, stage FROM cases WHERE id = $1", [caseId])).rows[0];
    if (!c) return null;
    const ms = (await tx.query<Row>(
      "SELECT m.stage, m.at, m.note, u.name, u.role FROM milestones m JOIN users u ON u.id = m.recorded_by WHERE m.case_id = $1 ORDER BY m.at, m.id", [caseId])).rows;
    const milestones: Milestone[] = ms.map((m) => ({ stage: m.stage, at: iso(m.at), note: m.note ?? null, recordedBy: { name: m.name, role: m.role } }));
    const idx = CASE_STAGES.indexOf(c.stage);
    return { caseId: c.id, firNo: c.fir_no, station: c.station, currentStage: c.stage as CaseStage, milestones, nextExpectedStage: CASE_STAGES[idx + 1] ?? null };
  });
  if (!out) { await logDenied(user.id, "case progress not accessible", { caseId }); throw notFound("Case unavailable"); }
  return out;
}

export async function addMilestone(user: SessionUser, caseId: string, stage: CaseStage, note?: string): Promise<CaseProgress> {
  if (!canAddMilestone(user.role)) { await logDenied(user.id, "milestone refused: role not allowed", { caseId }); throw forbidden("Only the investigating officer or a judge can record milestones"); }
  if (!(CASE_STAGES as readonly string[]).includes(stage)) throw invalid("Unknown case stage");
  const db = await getDb();
  const entry = await db.withUser(user.id, async (tx) => {
    requireRows((await tx.query("SELECT id FROM cases WHERE id = $1", [caseId])).rows, "Case");
    await tx.query("SELECT add_milestone($1, $2::case_stage, $3)", [caseId, stage, note ?? null]);
    return writeAudit(tx, { actorId: user.id, action: "MILESTONE_ADDED", caseId, basis: defaultBasis(user.role), detail: `${stage}${note ? `: ${note.slice(0, 120)}` : ""}` });
  }).catch(async (e) => {
    if ((e as { code?: string })?.code === "42501") await logDenied(user.id, "milestone refused by database policy", { caseId });
    throw e;
  });
  const chain = await getChain();
  if (chain) void chain.auditEvent({ subject: { caseId }, action: "MILESTONE_ADDED", actorId: user.id, entryHash: entry.entryHash, label: `Case milestone ${stage}` });
  return getProgress(user, caseId);
}
