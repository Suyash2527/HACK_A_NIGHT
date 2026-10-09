// SERVER-ONLY. Writes to the hash-chained audit log. The database trigger assigns seq / prev_hash / entry_hash / time,
// so values passed here for those columns are placeholders that the database overwrites.
import type { AuditAction, LegalBasis, LegalBasisCode, Role } from "@/types/api";
import { withUser, type Tx } from "./db";

export interface AuditInput {
  actorId: string;
  action: AuditAction;
  docId?: string | null;
  caseId?: string | null;
  basis: LegalBasis;
  detail?: string | null;
}
export interface AuditReceipt { id: string; seq: number; entryHash: string; prevHash: string; at: string }

/** Default lawful basis for a role acting on its own assignment. Advocates must pass their court-order basis explicitly. */
export function defaultBasis(role: Role): LegalBasis {
  const code: Record<Exclude<Role, "DEFENCE_ADVOCATE">, LegalBasisCode> = {
    POLICE: "INVESTIGATION",
    FORENSIC_LAB: "FORENSIC_ASSIGNMENT",
    PUBLIC_PROSECUTOR: "PROSECUTION_ASSIGNMENT",
    JUDGE: "JUDICIAL_AUTHORITY",
    ADMIN: "JUDICIAL_AUTHORITY",
    COMPLAINANT: "VICTIM_INFORMATION",
  };
  if (role === "DEFENCE_ADVOCATE") throw new Error("DEFENCE_ADVOCATE access needs an explicit court-order legal basis");
  return { code: code[role], citation: null, orderRef: null };
}

export const systemBasis = (): LegalBasis => ({ code: "SYSTEM_INTEGRITY", citation: null, orderRef: null });
export const courtOrderBasis = (citation: string, orderRef: string): LegalBasis => ({ code: "COURT_ORDER", citation, orderRef });

/** Appends one entry inside an existing transaction (so it commits or rolls back with the action it describes). */
export async function writeAudit(tx: Tx, e: AuditInput): Promise<AuditReceipt> {
  const r = await tx.query<{ id: string; seq: string; entry_hash: string; prev_hash: string; at: string }>(
    `INSERT INTO audit_log (actor_id, action, doc_id, case_id, legal_basis, detail, seq, at, prev_hash, entry_hash)
     VALUES ($1, $2::audit_action, $3, $4, $5::jsonb, $6, 0, now(), '', '')
     RETURNING id, seq, entry_hash, prev_hash, at`,
    [e.actorId, e.action, e.docId ?? null, e.caseId ?? null, JSON.stringify(e.basis), e.detail ?? null],
  );
  const row = r.rows[0];
  return { id: row.id, seq: Number(row.seq), entryHash: row.entry_hash, prevHash: row.prev_hash, at: new Date(row.at).toISOString() };
}

/**
 * Records a refused attempt in its OWN transaction (the refused action's transaction was rolled back).
 * Never throws: failing to log a denial must not turn a clean 403 into a 500.
 */
export async function logDenied(actorId: string, detail: string, ctx: { docId?: string | null; caseId?: string | null; basis?: LegalBasis } = {}): Promise<void> {
  try {
    await withUser(actorId, async (tx) => {
      const role = (await tx.query<{ role: Role }>("SELECT app_role() AS role")).rows[0]?.role;
      const basis = ctx.basis ?? (role && role !== "DEFENCE_ADVOCATE" ? defaultBasis(role) : systemBasis());
      await writeAudit(tx, { actorId, action: "DENIED", docId: ctx.docId, caseId: ctx.caseId, basis, detail: detail.slice(0, 300) });
    });
  } catch (e) {
    console.error("[audit] could not record DENIED entry", e);
  }
}
