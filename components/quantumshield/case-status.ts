import type { CaseSummary, VerifyStatus } from "@/types/api";

/** One status for a whole case: the worst document state wins; all-verified is shown only when every document is. */
export function caseStatus(c: CaseSummary): VerifyStatus | null {
  const x = c.integrity;
  if (x.TAMPERED) return "TAMPERED";
  if (x.ERROR) return "ERROR";
  if (x.PENDING_ANCHOR) return "PENDING_ANCHOR";
  if (x.UNANCHORED) return "UNANCHORED";
  return c.documentCount > 0 && x.VERIFIED === c.documentCount ? "VERIFIED" : null;
}

export function needsAttention(c: CaseSummary) {
  return c.integrity.TAMPERED > 0 || c.integrity.ERROR > 0;
}
