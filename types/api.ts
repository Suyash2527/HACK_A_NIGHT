/**
 * Sakshya API CONTRACT — single source of truth for every `app/api/**` route.
 * Owner: Claude Code. Codex/UI imports from here and never redefines these shapes;
 * request changes via docs/REQUESTS.md. Pure types + shared constants only (safe for client bundles).
 *
 * Conventions (fixed):
 *  - Hash      = 64-char lowercase hex, NO 0x (document/audit hashes, signed payloads)
 *  - ChainHex  = 0x-prefixed (tx hashes, on-chain roots, addresses)
 *  - ISODate   = ISO-8601 UTC string; UI displays IST
 *  - IDs are UUID strings; batchId is an integer
 *  - Errors: HTTP status + ApiErrorBody envelope. API routes never redirect.
 *  - Chunk indices / byte offsets are zero-based; byteEnd is inclusive.
 */

// ───────────────────────────── primitives
export type UUID = string;
export type ISODate = string;
export type Hash = string;
export type ChainHex = string;

export type Role =
  | "POLICE"
  | "FORENSIC_LAB"
  | "PUBLIC_PROSECUTOR"
  | "JUDGE"
  | "ADMIN"
  | "DEFENCE_ADVOCATE" // sees documents ONLY through a court-granted DocumentRequest
  | "COMPLAINANT"; //    sees ONLY the milestone timeline of their own case — never document contents
export type DocType = "FIR" | "WITNESS_STATEMENT" | "FORENSIC_REPORT" | "CHARGE_SHEET";

/** Order mirrors SakshyaRegistry.AuditAction on-chain (append only — never reorder). */
export const AUDIT_ACTIONS = [
  "UPLOAD", "VIEW", "DOWNLOAD", "VERIFY", "DENIED", "ANCHOR", "SCAN", "TAMPER_DETECTED", "RESTORE",
  "REQUEST_FILED", "REQUEST_GRANTED", "REQUEST_REJECTED", "FOLDER_ASSEMBLED", "MILESTONE_ADDED", "MANIFEST_SEALED",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * Why an access/write was lawful. Recorded on EVERY audit entry; `citation` is mandatory for
 * COURT_ORDER and STATUTORY_DISCLOSURE. Citations are free text entered by the judge/advocate
 * (e.g. "BNSS 2023 s.230") — the system records them, it does not interpret law.
 */
export type LegalBasisCode =
  | "INVESTIGATION" //         investigating officer on own/assigned case
  | "FORENSIC_ASSIGNMENT" //   lab assigned to the case
  | "PROSECUTION_ASSIGNMENT" // prosecutor assigned to the case
  | "JUDICIAL_AUTHORITY" //    judge/court reviewing the case file
  | "COURT_ORDER" //           access granted by a judge's order on a DocumentRequest
  | "STATUTORY_DISCLOSURE" //  advocate's request basis (statutory right to copies)
  | "VICTIM_INFORMATION" //    complainant's right to know investigation progress
  | "SYSTEM_INTEGRITY"; //     automated scans, anchoring, administration
export interface LegalBasis {
  code: LegalBasisCode;
  citation: string | null;
  orderRef: string | null; // court order / request reference when code = COURT_ORDER
}

// ───────────────────────────── shared constants (UI + server)
/** 4 MiB. Enforced client-side for UX and server-side (413 TOO_LARGE) for real. */
export const MAX_UPLOAD_BYTES = 4_194_304;
export const ALLOWED_UPLOAD_MIME = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "text/plain": ".txt",
  "image/png": ".png",
  "image/jpeg": ".jpg",
} as const;
export type AllowedMime = keyof typeof ALLOWED_UPLOAD_MIME;

/** RBAC upload matrix. Mirrors the SQL RLS policy; ABAC (case assignment) is checked separately. */
export const ROLE_UPLOAD_TYPES: Record<Role, readonly DocType[]> = {
  POLICE: ["FIR", "WITNESS_STATEMENT"],
  FORENSIC_LAB: ["FORENSIC_REPORT"],
  PUBLIC_PROSECUTOR: ["CHARGE_SHEET"],
  JUDGE: [],
  ADMIN: [],
  DEFENCE_ADVOCATE: [],
  COMPLAINANT: [],
};

/** Documents are stored as independently encrypted parts of this size, each addressed by its SHA-256. */
export const STORAGE_PART_BYTES = 65_536;
/** Integrity (Merkle) chunks inside each document — used to pinpoint tampered byte ranges. */
export const MERKLE_CHUNK_BYTES = 4_096;

/** Ordered case lifecycle shown on the complainant progress timeline. */
export const CASE_STAGES = [
  "FIR_REGISTERED", "INVESTIGATION", "FORENSIC_ANALYSIS", "CHARGE_SHEET_FILED", "TRIAL", "JUDGMENT", "CLOSED",
] as const;
export type CaseStage = (typeof CASE_STAGES)[number];

// ───────────────────────────── errors
export type ErrorCode =
  | "UNAUTHENTICATED" // 401
  | "FORBIDDEN" //       403 — always also audited as DENIED
  | "NOT_FOUND" //       404
  | "TAMPERED" //        409
  | "TOO_LARGE" //       413
  | "VALIDATION" //      422
  | "CHAIN_UNAVAILABLE" // 503
  | "FEATURE_DISABLED"; // 503 — deferred/bonus features (assistant, public verify)

export const ERROR_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, TAMPERED: 409,
  TOO_LARGE: 413, VALIDATION: 422, CHAIN_UNAVAILABLE: 503, FEATURE_DISABLED: 503,
};

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: Record<string, unknown> };
}

// ───────────────────────────── verification (FIXED — do not change shape)
export type CheckStatus = "pass" | "fail" | "skip";
export type VerifyStatus = "VERIFIED" | "TAMPERED" | "PENDING_ANCHOR" | "UNANCHORED" | "ERROR";

export interface TamperRange {
  chunkIndex: number;
  byteStart: number;
  byteEnd: number; // inclusive
  kind: "modified" | "added" | "removed";
}

export interface AnchorInfo {
  batchId: number;
  root: ChainHex;
  txHash: ChainHex;
  explorerUrl: string | null; // null on the local dev chain
  status: "pending" | "confirmed";
}

export interface PartCheck {
  index: number; // zero-based
  byteStart: number; // plaintext offset covered by this part (inclusive)
  byteEnd: number;
  address: Hash; // sha256 of the stored encrypted part = its storage key
  status: CheckStatus; // pass = address matches AND decrypts; fail = altered/missing
}

export interface Accessor {
  actorName: string;
  role: Role;
  action: AuditAction;
  at: ISODate;
}

export interface VerifyResult {
  status: VerifyStatus;
  checks: {
    decrypt: CheckStatus; //       AES-256-GCM authenticated decryption
    plaintextHash: CheckStatus; // recomputed SHA-256 vs signed original
    chunkRoot: CheckStatus; //     4 KiB chunk Merkle root vs original
    signature: CheckStatus; //     ML-DSA-65, verified OFF-chain by our backend
    merkleProof: CheckStatus; //   document leaf ∈ batch root
    onChainRoot: CheckStatus; //   batch root == root stored on Polygon
  };
  tamperRanges: TamperRange[];
  /** ADDITIVE: per stored part. A part fails if its stored bytes no longer hash to its address or fail GCM. */
  parts?: PartCheck[];
  anchor?: AnchorInfo; // omitted until a batch tx exists
  lastAccessors: Accessor[];
  originalVersionAvailable: boolean; // S3 Object Lock retains a verifiable original
}

// ───────────────────────────── auth / session
export interface LoginRequest { email: string; password: string }
export interface Session {
  user: { id: UUID; name: string; email: string; role: Role; station: string; clearance: number };
  canCreateCase: boolean;
  allowedUploadTypes: DocType[];
  assistantEnabled: boolean;
}

// ───────────────────────────── cases
export type IntegrityCounts = Record<VerifyStatus, number> & { unchecked: number };

export interface CaseSummary {
  id: UUID;
  firNo: string;
  station: string;
  stage: CaseStage;
  status: "OPEN" | "CLOSED";
  createdAt: ISODate;
  documentCount: number;
  integrity: IntegrityCounts;
}
/**
 * The FIR number is assigned by the SYSTEM and is tamper-proof: `STATION/YEAR/SERIAL/CODE`, e.g. `GNG/2026/0007/A3F9`.
 * SERIAL is gapless per station and year; CODE is a verification code derived from a hash-chained FIR register, so a
 * forged or edited number cannot validate. The officer never types or edits it. Station comes from the signed-in officer.
 */
export interface CreateCaseRequest { complainantEmail?: string }
/** Pattern for display / input validation of an FIR number. */
export const FIR_NUMBER_PATTERN = /^[A-Z]{2,4}\/\d{4}\/\d{4}\/[0-9A-F]{4}$/;
export interface FirCheck { firNo: string; genuine: boolean; stationCode: string | null; issuedAt: ISODate | null }
export interface FirRegisterResult { status: CheckStatus; checkedEntries: number; checkedAt: ISODate; firstBrokenSeq: number | null; problem: string | null }
export interface CaseDetail extends CaseSummary {
  allowedUploadTypes: DocType[]; // role matrix ∩ case assignment
  canUpload: boolean;
  assignments: { userName: string; role: Role }[];
  /** The case "folder": Merkle root over every document leaf in the case, sealed on-chain per version. */
  manifest: CaseManifest | null;
  canAssemble: boolean; // JUDGE / ADMIN / assigned PROSECUTOR; DEFENCE_ADVOCATE only over granted docs
  canRequestDocuments: boolean; // DEFENCE_ADVOCATE linked to the case
}

export interface CaseManifest {
  version: number; // increments whenever a document is added to the folder
  root: Hash;
  documentCount: number;
  sealedAt: ISODate;
  anchor: { txHash: ChainHex; explorerUrl: string | null; status: "pending" | "confirmed" } | null;
}

// ───────────────────────────── complainant progress (milestones only, no document content)
export interface Milestone {
  stage: CaseStage;
  at: ISODate;
  note: string | null; // public-safe note written by police/court
  recordedBy: { name: string; role: Role };
}
export interface CaseProgress {
  caseId: UUID;
  firNo: string;
  station: string;
  currentStage: CaseStage;
  milestones: Milestone[]; // chronological
  nextExpectedStage: CaseStage | null;
}
export interface AddMilestoneRequest { stage: CaseStage; note?: string }

// ───────────────────────────── advocate document requests → judge decision
export type RequestStatus = "PENDING" | "GRANTED" | "REJECTED" | "EXPIRED";
export interface DocumentRequest {
  id: UUID;
  caseId: UUID;
  firNo: string;
  requester: { id: UUID; name: string; role: Role };
  documentIds: UUID[]; // what was asked for
  legalBasis: LegalBasis; // advocate's stated basis (citation required)
  reason: string;
  status: RequestStatus;
  filedAt: ISODate;
  decision: {
    by: { id: UUID; name: string };
    at: ISODate;
    orderRef: string; // court order reference recorded with the grant
    note: string;
    grantedDocumentIds: UUID[]; // judge may grant a subset
    permission: "VIEW_AND_WATERMARKED_DOWNLOAD";
    expiresAt: ISODate | null;
  } | null;
}
/**
 * What a DEFENCE_ADVOCATE (or the court) may look up by FIR number BEFORE asking for access: identifiers and titles only —
 * never content, hashes, custody or verification state. Needed to fill FileRequestBody.caseId / documentIds.
 */
export interface RequestCatalog {
  caseId: UUID;
  firNo: string;
  station: string;
  stage: CaseStage;
  documents: { id: UUID; type: DocType; filename: string; version: number; createdAt: ISODate }[];
}
export interface FileRequestBody {
  caseId: UUID;
  documentIds: UUID[];
  legalBasis: { code: "STATUTORY_DISCLOSURE" | "COURT_ORDER"; citation: string };
  reason: string;
}
export interface DecideRequestBody {
  decision: "GRANT" | "REJECT";
  orderRef: string;
  note: string;
  grantedDocumentIds?: UUID[]; // defaults to all requested
  expiresAt?: ISODate | null;
}

// ───────────────────────────── case folder assembly (court bundle)
export interface AssemblyReport {
  caseId: UUID;
  assembledAt: ISODate;
  scope: "FULL_CASE" | "GRANTED_DOCUMENTS"; // advocates only ever get GRANTED_DOCUMENTS
  manifest: { root: Hash; version: number; recomputed: Hash; onChain: CheckStatus } | null;
  totals: { documents: number; parts: number; partsVerified: number; tampered: number };
  documents: { document: DocumentSummary; verification: VerifyResult }[];
  /** Present only when every included document VERIFIED. ZIP with files + manifest.json + hash certificate. */
  bundle: { downloadPath: string; sha256: Hash; sizeBytes: number; expiresAt: ISODate } | null;
}

export interface Page<T> { items: T[]; nextCursor: string | null }

// ───────────────────────────── documents
export interface DocumentSummary {
  id: UUID;
  caseId: UUID;
  filename: string;
  type: DocType;
  version: number;
  parentId: UUID | null;
  sizeBytes: number;
  mimeType: AllowedMime;
  uploaderName: string;
  createdAt: ISODate;
  sha256: Hash;
  chunkRoot: Hash;
  chunkCount: number;
  partCount: number; // stored encrypted parts (STORAGE_PART_BYTES each)
  verificationStatus: VerifyStatus | null; // null = never checked
  verifiedAt: ISODate | null;
}

export interface DocumentDetail extends DocumentSummary {
  versions: DocumentSummary[]; // full lineage, oldest first
  signature: { algorithm: "ML-DSA-65"; signerName: string; publicKeyHash: Hash };
  /** blockchain transactions recorded for this document (newest first); empty when the chain is not configured */
  chain?: ChainTx[];
  canPreview: boolean;
  canDownload: boolean; // downloads via a grant are watermarked (advocate name, order ref, sha256)
  canAddVersion: boolean;
  canRestore: boolean;
  access: { via: "ROLE" } | { via: "GRANT"; requestId: UUID; orderRef: string; expiresAt: ISODate | null };
}

/** multipart/form-data fields of POST /api/documents */
export interface UploadFormFields { file: File; caseId: UUID; type: DocType; parentId?: UUID }

export interface UploadReceipt {
  document: DocumentSummary;
  encryption: "AES-256-GCM";
  keyWrapping: "ML-KEM-768";
  signature: { algorithm: "ML-DSA-65"; status: CheckStatus };
  auditEntryId: UUID;
  verification: VerifyResult; // normally UNANCHORED right after upload
}

export interface RestoreRequest { reason: string }

// ───────────────────────────── audit
export interface AuditEntry {
  id: UUID;
  seq: number;
  actorName: string;
  role: Role;
  action: AuditAction;
  docId: UUID | null;
  caseId: UUID | null;
  at: ISODate;
  prevHash: Hash;
  entryHash: Hash;
  legalBasis: LegalBasis; // why this access/write was lawful — part of the hashed entry
  detail: string | null; // e.g. denial reason; never document content
}
export interface AuditChainResult {
  status: CheckStatus;
  checkedEntries: number;
  checkedAt: ISODate;
  firstBrokenEntryId: UUID | null;
  headHash: Hash | null;
  headAnchored: boolean; // head hash included in an anchored batch payload
}

// ───────────────────────────── integrity scans
// POST runs synchronously (≤ 50 documents) and returns the completed ScanDetail;
// the id lets the UI re-open a result via GET /api/integrity/scans/[id].
export interface ScanRequest { caseId?: UUID }
export interface ScanDetail {
  id: UUID;
  status: "running" | "completed" | "failed";
  checked: number;
  total: number;
  startedAt: ISODate;
  completedAt: ISODate | null;
  results: { document: DocumentSummary; verification: VerifyResult }[];
  error?: { code: ErrorCode; message: string };
}

// ───────────────────────────── batches / chain
export interface BatchSummary {
  batchId: number;
  root: ChainHex;
  documentCount: number;
  status: "pending" | "confirmed";
  txHash: ChainHex | null;
  explorerUrl: string | null;
  signatureHash: Hash; // sha256 of the system ML-DSA-65 signature over the batch payload
  createdAt: ISODate;
  anchoredAt: ISODate | null;
}
/** One on-chain transaction sent by the backend (register a record, attest a signature, seal a case folder, anchor a batch...). */
export type ChainTxKind = "REGISTER_RECORD" | "ATTEST_SIGNATURE" | "SEAL_MANIFEST" | "AUDIT_EVENT" | "ANCHOR_BATCH";
export interface ChainTx {
  id: UUID;
  kind: ChainTxKind;
  txHash: ChainHex;
  /** null on the local dev chain (no public explorer) */
  explorerUrl: string | null;
  status: "submitted" | "confirmed" | "failed";
  blockNumber: number | null;
  docId: UUID | null;
  caseId: UUID | null;
  label: string; // human sentence, e.g. "Registered document FIR_0142.txt v1"
  at: ISODate;
  confirmedAt: ISODate | null;
}
export interface ChainInfo {
  network: "local" | "sepolia" | "amoy" | "polygon";
  chainId: number;
  registryAddress: ChainHex;
  explorerAddressUrl: string | null;
}

// ───────────────────────────── demo-only (exists only when the server runs with SAKSHYA_DEMO_ATTACK=1; otherwise 404)
export interface DemoAttackRequest { docId: UUID; offset?: number }
/** Insider simulation: ONE plaintext byte is flipped and re-encrypted validly in storage, behind the application's back. */
export interface DemoAttackReport {
  docId: UUID; offset: number; partIndex: number; flippedByte: { before: number; after: number }; overwrittenAddress: Hash; note: string;
}

// ───────────────────────────── deferred / bonus (types reserved; routes return FEATURE_DISABLED until built)
export interface PublicReceipt { docId: UUID; checkedAt: ISODate; verification: VerifyResult }
export interface AssistantRequest { caseId: UUID; question: string }
export interface AssistantAnswer {
  answer: string;
  noAnswer: boolean;
  citations: { docId: UUID; filename: string; quote: string; sha256: Hash; verification: VerifyResult }[];
}

// ───────────────────────────── endpoint map (documentation + typed fetch helper input)
type Q<T> = { query: T };
export interface ApiRoutes {
  "POST /api/auth/login": { body: LoginRequest; res: Session };
  "POST /api/auth/logout": { res: { ok: true } };
  "GET /api/auth/session": { res: Session };

  "GET /api/cases": Q<{ q?: string; cursor?: string; limit?: number }> & { res: Page<CaseSummary> };
  "POST /api/cases": { body: CreateCaseRequest; res: CaseDetail };
  /** Anyone signed in may confirm an FIR number is genuine (exists in the register with a matching verification code). */
  "GET /api/fir/check": Q<{ firNo: string }> & { res: FirCheck };
  /** JUDGE/ADMIN: recompute the whole FIR register (sequence, chain, numbers, gapless serials). */
  "POST /api/fir/verify-register": { res: FirRegisterResult };
  "GET /api/cases/[id]": { res: CaseDetail };
  /** COMPLAINANT (own case), police/court roles; never includes document data */
  "GET /api/cases/[id]/progress": { res: CaseProgress };
  /** POLICE (assigned) or JUDGE */
  "POST /api/cases/[id]/milestones": { body: AddMilestoneRequest; res: CaseProgress };
  /** fetch every permitted part, verify, rebuild the folder; bundle only if all VERIFIED */
  "POST /api/cases/[id]/assemble": { res: AssemblyReport };
  /** ZIP download of an assembled bundle (short-lived path from AssemblyReport.bundle) */
  "GET /api/cases/[id]/bundle": Q<{ token: string }> & { res: Blob };

  /** DEFENCE_ADVOCATE / JUDGE / ADMIN: look up a case's document titles by FIR number to build a request (404 when unknown) */
  "GET /api/requests/catalog": Q<{ firNo: string }> & { res: RequestCatalog };
  /** DEFENCE_ADVOCATE files; JUDGE sees all for their cases; advocate sees own */
  "POST /api/requests": { body: FileRequestBody; res: DocumentRequest };
  "GET /api/requests": Q<{ caseId?: UUID; status?: RequestStatus }> & { res: Page<DocumentRequest> };
  /** JUDGE only; GRANT creates time-limited, document-specific access */
  "POST /api/requests/[id]/decision": { body: DecideRequestBody; res: DocumentRequest };

  "GET /api/documents": Q<{ caseId: UUID; cursor?: string; limit?: number }> & { res: Page<DocumentSummary> };
  "POST /api/documents": { form: UploadFormFields; res: UploadReceipt };
  "GET /api/documents/[id]": { res: DocumentDetail };
  /** binary body; Content-Disposition from ?disposition=inline|attachment; 409 TAMPERED if verification fails */
  "GET /api/documents/[id]/content": Q<{ disposition?: "inline" | "attachment" }> & { res: Blob };
  "POST /api/documents/[id]/verify": { res: VerifyResult };
  "POST /api/documents/[id]/restore": { body: RestoreRequest; res: UploadReceipt };

  "GET /api/audit": Q<{ docId?: UUID; caseId?: UUID; action?: AuditAction; from?: ISODate; to?: ISODate; cursor?: string; limit?: number }> & { res: Page<AuditEntry> };
  "POST /api/audit/verify": { res: AuditChainResult };

  "POST /api/integrity/scans": { body: ScanRequest; res: ScanDetail };
  "GET /api/integrity/scans/[id]": { res: ScanDetail };

  "GET /api/batches": Q<{ cursor?: string; limit?: number }> & { res: Page<BatchSummary> };
  "GET /api/chain": { res: ChainInfo };
  /** live feed of backend transactions, newest first — the "watch it happen" view for judges */
  "GET /api/chain/transactions": Q<{ docId?: UUID; caseId?: UUID; cursor?: string; limit?: number }> & { res: Page<ChainTx> };

  /** ADMIN only, and only when SAKSHYA_DEMO_ATTACK=1 on the server (404 otherwise). Rehearsal tool for the tamper-detection scene. */
  "POST /api/demo/attack": { body: DemoAttackRequest; res: DemoAttackReport };

  // deferred — return 503 FEATURE_DISABLED until built
  "GET /api/verify/[docId]": { res: PublicReceipt };
  "POST /api/assistant": { body: AssistantRequest; res: AssistantAnswer };
}
export type ApiRoute = keyof ApiRoutes;
