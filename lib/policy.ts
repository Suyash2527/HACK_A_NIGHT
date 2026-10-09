// SERVER-ONLY policy layer. First line of defence: the API refuses early with a clear error (and audits it).
// The database row-level security in db/schema.sql is the second, authoritative line — both must agree.
import { ROLE_UPLOAD_TYPES, type DocType, type Role } from "@/types/api";
import { forbidden } from "./errors";

export const COURT_ROLES: readonly Role[] = ["JUDGE", "ADMIN"];
export const isCourt = (r: Role) => COURT_ROLES.includes(r);

export const allowedUploadTypes = (r: Role): DocType[] => [...ROLE_UPLOAD_TYPES[r]];
export const canUploadType = (r: Role, t: DocType) => ROLE_UPLOAD_TYPES[r].includes(t);
export const canCreateCase = (r: Role) => r === "POLICE";
export const canDecideRequests = (r: Role) => r === "JUDGE";
export const canFileRequests = (r: Role) => r === "DEFENCE_ADVOCATE";
export const canAddMilestone = (r: Role) => r === "POLICE" || r === "JUDGE";
export const canRunScan = (r: Role) => isCourt(r);
export const canVerifyAuditChain = (r: Role) => isCourt(r);
export const canAssemble = (r: Role) => r === "JUDGE" || r === "ADMIN" || r === "PUBLIC_PROSECUTOR" || r === "DEFENCE_ADVOCATE";
/** Evidence is shown to roles that work the case; advocates only via grants, complainants never. */
export const seesEvidenceByRole = (r: Role) => r !== "DEFENCE_ADVOCATE" && r !== "COMPLAINANT";

export function requireRole(role: Role, allowed: readonly Role[], what: string): void {
  if (!allowed.includes(role)) throw forbidden(`${role} cannot ${what}`);
}
export function requireUploadType(role: Role, type: DocType): void {
  if (!canUploadType(role, type)) throw forbidden(`${role} cannot upload ${type} documents`);
}

/** Restore is allowed for the original uploader's role and type — never for court roles (they are read-only on evidence). */
export const canRestoreDoc = (role: Role, uploaderRole: Role, type: DocType) =>
  !isCourt(role) && role === uploaderRole && canUploadType(role, type);

/** Watermark text stamped onto court-granted copies. */
export const watermarkLine = (advocate: string, orderRef: string, sha256: string, at: Date) =>
  `Sakshya copy · ${advocate} · Order ${orderRef} · sha256 ${sha256.slice(0, 16)}… · ${at.toISOString()}`;
