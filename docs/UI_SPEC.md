# QuantumShield UI specification

## Scope risks & cuts

- Judges must see upload → verification → denied access → tamper → recovery working; any individual feature exceeding four hours goes on the cut list.
- Cut first: Bedrock assistant, animated crypto pipeline, analytics charts, rich DOCX preview, advanced filters; keep their routes with honest unavailable states.
- Pre-anchor a fixture: Amoy confirmation is outside our control. Pending or unavailable chain checks must never produce a green VERIFIED badge.
- Object Lock preserves an older S3 version; it does not stop a new malicious version becoming current. Recovery must append a document version, preserve the incident, and re-verify.
- A trusted backend performs PQ verification. Show that boundary; do not claim quantum-safe blockchain consensus, cryptographic proof of accessor guilt, or production readiness.

Assumption: current full-AWS spec supersedes the earlier FastAPI brief: Next.js API routes on EC2 + CloudFront; restore is an authorized new-version upload; public verification is opt-in proof-only; chunk indices and byte offsets are zero-based, byteEnd inclusive.

Planning only. Claude owns `types/api.ts` and final DTOs; the shapes below are proposals for that contract, not client-side type definitions. No scaffolding, packages, or implementation in this session. Deadline: 2026-10-10 12:00 IST.

## Routes and permissions

P = POLICE; F = FORENSIC_LAB; R = PUBLIC_PROSECUTOR; J = JUDGE; A = ADMIN. Visibility never grants access: API RBAC/ABAC and RDS RLS authorize every request. Hidden controls do not replace enforcement. All record routes handle direct-link 403.

| App Router path | Visible to | Scope / actions |
|---|---|---|
| `/login` | Anyone | Cognito sign-in; authenticated users continue to dashboard |
| `/dashboard` | P F R J A | Assigned/own cases for P/F/R; all cases for J/A |
| `/cases` | P F R J A | Same scope; create case only P |
| `/cases/[id]` | P F R J A | P own, F/R assigned, J/A all; upload only allowed types/stages/clearance |
| `/documents/[id]` | P F R J A | API grants per document; F evidence-list access does not imply document content access |
| `/audit` | J A | Full audit and chain verification; others get permitted custody events inside document page |
| `/integrity` | J A | Read findings and run read-only scans; no evidence mutation |
| `/batches` | J A | All batch proofs; other roles get permitted document's anchor inside IntegrityPanel |
| `/verify/[docId]` | Public | Opt-in proof receipt only; unpublished/unknown IDs return identical 404 |
| `/assistant` | P F R J A | Bonus; only retrievable content the actor can read; disabled if unavailable |

P uploads FIR/witness statements for own cases; F uploads forensic reports for assigned cases; R uploads charge sheets for assigned cases. J/A are read-only on evidence, including restore. Policy-derived capabilities control buttons. No edit/delete controls, including case edits. Corrections: “Add new version”, with `parentId`. No UI to run the attack.

## Shell, components and state rules

Desktop: 240px Sidebar, 64px header (case breadcrumb, actor/role, logout), max-width 1440px content; mobile: Sheet navigation, stacked panels, scrollable tables. Persistent “QuantumShield · Evidence integrity” wordmark and AWS & trust strip. Use Radix-based shadcn primitives (Dialog, AlertDialog, Sheet, Select, Tabs, Tooltip, DropdownMenu, ScrollArea) with shadcn Card, Badge, Button, Input, Label, Table, Skeleton, Alert, Separator and Progress. Search is optional; no unrelated metrics.

Every page uses these explicit states; a page with no verification data does not invent an integrity badge:

| State | Rendering and behavior |
|---|---|
| Loading | Layout-matched Skeleton; `aria-busy`; action spinner disables duplicate submission |
| Empty | Specific reason + permitted next action; no green zero-document summary |
| VERIFIED | Green shield-check + “Verified”; show check time and all six results |
| TAMPERED | Red shield-alert + “Integrity mismatch”; quarantine normal preview/download; open findings |
| PENDING_ANCHOR | Amber clock + “Pending anchor”; local results visible, “Awaiting chain confirmation” |
| UNANCHORED | Neutral dashed shield + “Not anchored”; never call fully verified |
| Access denied | Red lock + “Access denied. This attempt has been recorded.” only after confirmed 403; no record metadata |
| Error / ERROR | Destructive Alert + retry; “Could not verify” is distinct from detected tampering; preserve last result as stale |

401 → login with a validated internal return path. 403 → denied panel (backend audits DENIED). 404 → generic “Record unavailable”. 409 → tamper alert, request verification details. 413 → “File exceeds 4 MB”. 422 → inline message. 503 → “Blockchain unavailable; on-chain verification incomplete.” Network failure → retry / explicitly choose demo data. All API errors use `{error:{code,message}}`; codes/statuses: UNAUTHENTICATED/401, FORBIDDEN/403, NOT_FOUND/404, TAMPERED/409, TOO_LARGE/413, VALIDATION/422, CHAIN_UNAVAILABLE/503. Never convert an error into VERIFIED.

State lists below use V/T/P/U for verified/tampered/pending-anchor/unanchored. Those always inherit the colors, labels and behavior above. Counts and badges reflect returned results, never client guesses.

## Per-page wireframes and data

| Page / purpose | Components in reading order | Exact data needed | States |
|---|---|---|---|
| `/login` — establish identity | Card, Label/Input email/password, Button sign in, Alert, seeded-role guidance without embedded credentials | Session after sign-in; API error | Loading/submitting; empty fields; denied authentication; error/retry. V/T/P/U not applicable |
| `/dashboard` — prioritize evidence work | Role heading, Card counts, recent-case Table, integrity Alert, permitted quick actions | Session; Dashboard; CaseSummary | Loading; no accessible cases; V/T/P/U cards; denied; error |
| `/cases` — find/create a case | Heading, FIR Input filter, Table, P-only Dialog create case, pagination Button | Page<CaseSummary>; Session.canCreateCase; CreateCaseRequest | Loading; no cases/no matches; V/T/P/U counts; denied; error; create submitting/422/success |
| `/cases/[id]` — manage append-only evidence | Breadcrumb, case Card, Tabs documents/case details, document Table, Upload Dialog, version badges | CaseDetail; Page<DocumentSummary>; UploadReceipt | Loading; no documents; V/T/P/U rows; denied; error; upload validation/progress/success |
| `/documents/[id]` — inspect evidence and custody | Metadata Card; Tabs preview/versions/custody; PDF/image/text viewer; IntegrityPanel; new-version Dialog | DocumentDetail; VerifyResult; Page<AuditEntry>; authorized content response | Loading/verifying; no permitted preview/no custody/no older version; V/T/P/U panel; denied; error. DOCX: verified download + no inline preview |
| `/audit` — trace actions and audit-chain integrity | Action Select, date Inputs, Table, expandable hash/signature row, Button “Verify audit chain”, Alert | Page<AuditEntry>; AuditChainResult | Loading; no matching events; signed-entry pass green/broken chain red/unchecked neutral; DENIED rows red; denied; error. V/T/P/U only if a document result is explicitly returned, not inferred from events |
| `/integrity` — locate damage | Button “Run integrity scan”, Progress, summary Cards, findings Table, Sheet containing IntegrityPanel | ScanReceipt; ScanDetail; document identity for each result | Loading; never scanned/zero accessible documents; running/partial/completed/failed; V/T/P/U per result; denied; error with completed findings retained |
| `/batches` — inspect public commitments | Table, expandable Card root/proof metadata, explorer Button | Page<BatchSummary> | Loading; no batches; confirmed anchor green labelled “Anchor confirmed” (not document VERIFIED), pending amber, mismatch red only from verification result; denied; error. Unanchored documents are not batches |
| `/verify/[docId]` — public receipt without evidence disclosure | Public heading, receipt Card, IntegrityPanel, trust Alert, no authenticated shell | PublicReceipt with sanitized VerifyResult | Loading; unpublished/absent generic 404; V/T/P/U panel; denied without metadata; error. No preview, custody identity, restore, case data or document filename |
| `/assistant` — ask about permitted evidence | Case Select, suggested-question Buttons, ScrollArea conversation, Input, cited-source Cards | permitted CaseSummary list; Session.assistantEnabled; AssistantAnswer | Loading/thinking; empty conversation/no accessible cases; unavailable bonus; V/T/P/U citations; denied; error/retry. No-answer state; never use tampered sources as verified support |

Upload Dialog: Select document type from server `allowedUploadTypes`; Input file; parent-version summary when parentId supplied; file summary; submit; receipt showing plaintext hash, encryption success, ML-DSA signature success, audit entry ID. States: idle, validation failure, uploading, server processing, success, failure. Do not animate inferred crypto stages: receipt fields confirm completion. Accept `.pdf,.docx,.txt,.png,.jpg` and MIME checks; backend validates content. Assumption: 4 MB = 4,194,304 bytes, confirm in final contract. Success starts UNANCHORED or PENDING_ANCHOR unless VerifyResult explicitly says VERIFIED.

Preview: fetch authenticated, freshly verified content without cache; render in memory only; release object URLs on close. No localStorage/IndexedDB/service-worker plaintext or persistence of chat/document text. Normal content fetch rejects known tampering; DOCX uses authorized download. Download is an explicit audited user export, never an automatic browser save.

## Proposed data contract (Claude to finalize in types/api.ts)

All `UUID`, `ISODate`, `Hash` and `ChainHex` aliases serialize as strings. UUIDs for IDs, integer batchId; `Hash` = exactly 64 lowercase hex without `0x`; `ChainHex` = `0x`-prefixed chain values (root/txHash/address). Dates ISO-8601 UTC (e.g. `2026-10-10T05:00:00Z`); UI displays IST explicitly. On-chain BatchSummary.root / VerifyResult.anchor.root use ChainHex; document sha256/chunkRoot and audit hashes use Hash. Public proof hashes reveal commitments, not source bytes.

```ts
type Role = 'POLICE' | 'FORENSIC_LAB' | 'PUBLIC_PROSECUTOR' | 'JUDGE' | 'ADMIN';
type DocType = 'FIR' | 'WITNESS_STATEMENT' | 'FORENSIC_REPORT' | 'CHARGE_SHEET';
type Page<T> = { items: T[]; nextCursor: string | null };
type Session = { user: { id: UUID; name: string; role: Role; station: string; clearance: number }; canCreateCase: boolean; assistantEnabled: boolean };
type Counts = { VERIFIED: number; TAMPERED: number; PENDING_ANCHOR: number; UNANCHORED: number; ERROR: number; unchecked: number };
type CaseSummary = { id: UUID; firNo: string; station: string; stage: string; status: string; createdAt: ISODate; documentCount: number; integrity: Counts };
type Dashboard = { accessibleCases: number; documents: number; integrity: Counts; recentCases: CaseSummary[]; lastScanAt: ISODate | null };
type CreateCaseRequest = { firNo: string; station: string }; // stage/status default on server
type CaseDetail = CaseSummary & { allowedUploadTypes: DocType[]; canUpload: boolean };
type DocumentSummary = { id: UUID; caseId: UUID; filename: string; type: DocType; version: number; parentId: UUID | null; sizeBytes: number; mimeType: string; uploaderName: string; createdAt: ISODate; sha256: Hash; chunkRoot: Hash; verificationStatus: VerifyResult['status'] | null; verifiedAt: ISODate | null };
type DocumentDetail = DocumentSummary & { versions: DocumentSummary[]; canPreview: boolean; canDownload: boolean; canAddVersion: boolean; canRestore: boolean; custodyAvailable: boolean };
type UploadReceipt = { document: DocumentSummary; encryption: 'AES-256-GCM'; keyWrapping: 'ML-KEM-768'; signature: { algorithm: 'ML-DSA-65'; status: 'pass' }; auditEntryId: UUID; verification: VerifyResult };
type AuditEntry = { id: UUID; actorName: string; role: Role; action: 'UPLOAD' | 'VIEW' | 'DOWNLOAD' | 'VERIFY' | 'DENIED' | 'ANCHOR' | 'SCAN'; docId: UUID | null; caseId: UUID | null; at: ISODate; prevHash: Hash; entryHash: Hash; signatureStatus: 'pass' | 'fail' | 'skip' };
type AuditChainResult = { status: 'pass' | 'fail' | 'skip'; checkedEntries: number; checkedAt: ISODate; firstBrokenEntryId: UUID | null; signatureStatus: 'pass' | 'fail' | 'skip' };
type ScanReceipt = { id: UUID; status: 'queued' | 'running' };
type ScanSummary = { id: UUID; status: 'queued' | 'running' | 'completed' | 'failed' };
type ScanDetail = { id: UUID; status: 'queued' | 'running' | 'completed' | 'failed'; checked: number; total: number; startedAt: ISODate; completedAt: ISODate | null; results: { document: DocumentSummary; verification: VerifyResult }[]; error?: { code: string; message: string } };
type BatchSummary = { batchId: number; root: ChainHex; documentCount: number; status: 'pending' | 'confirmed'; txHash: ChainHex | null; explorerUrl: string | null; createdAt: ISODate; anchoredAt: ISODate | null; signatureHash: Hash };
type PublicReceipt = { docId: UUID; checkedAt: ISODate; verification: VerifyResult };
type AssistantAnswer = { answer: string; citations: { docId: UUID; filename: string; quote: string; sha256: Hash; verification: VerifyResult }[]; noAnswer: boolean };
```

Reuse fixed `VerifyResult` unchanged: status VERIFIED/TAMPERED/PENDING_ANCHOR/UNANCHORED/ERROR; checks decrypt/plaintextHash/chunkRoot/signature/merkleProof/onChainRoot each pass/fail/skip; tamperRanges `{chunkIndex,byteStart,byteEnd,kind}[]`; optional anchor `{batchId,root,txHash,explorerUrl,status:'pending'|'confirmed'}`; lastAccessors `{actorName,role,action,at}[]`; originalVersionAvailable boolean. `kind` is backend text; render safely, never as HTML. Omit anchor until all its required fields exist; status can be PENDING_ANCHOR without an anchor object.

List query: `cursor`, `limit` (default 20); cases optional `q`; documents require `caseId`; audit optional `docId`, `caseId`, `action`, `from`, `to`. Scan history can return latest scan ID via its list endpoint. No cloud credentials, wrapped keys, raw signatures, S3 paths or plaintext bodies in metadata DTOs. Login request `{email,password}`, session cookie response; logout has no body. Upload request multipart `{file,caseId,type,parentId?}`; restore `{reason}`; scan `{caseId?}` (absent = authorized global scope); assistant `{caseId,question}`. Case creation uses CreateCaseRequest.

PublicReceipt: only explicitly published fixture receipts; verification.lastAccessors = [], originalVersionAvailable = false, tamperRanges = [] to avoid evidence-size leakage. Six checks describe backend verification of the private evidence without returning it; this is a published backend attestation, not independent client verification. No public discovery/listing endpoint.

## Shared `<IntegrityPanel>`

Input: fixed VerifyResult only for integrity content; loading/error shell outside. Read `result.status` for header; never derive green from an existing txHash. Separate wrapper provides permission and restore handler, never replaces result fields.

| Check key | Row label | Helper text |
|---|---|---|
| decrypt | Authenticated decryption | AES-256-GCM ciphertext and authentication tag |
| plaintextHash | Plaintext SHA-256 | Recomputed content vs signed original hash |
| chunkRoot | Document chunk root | 4,096-byte chunk hashes vs original chunk tree |
| signature | ML-DSA-65 signature | Verified off-chain by our backend verifier |
| merkleProof | Batch inclusion proof | Document commitment belongs to the batch root |
| onChainRoot | Polygon Amoy root | Batch commitment matches the on-chain root |

Each row: label, status icon, “Pass” green / “Fail” red / “Not checked” neutral, Tooltip helper. All six rows always visible; skip is never pass. Decrypt failure may prevent localization: show “Content could not be decrypted; affected chunk unavailable” when no ranges. Empty ranges for non-tampered results: “No chunk mismatch reported”; empty tampered ranges: “Tampering detected; range unavailable.”

Tamper section: list every returned range verbatim as “chunk 2, bytes 8192–12287”, with kind beside it. Caption “Zero-based indices; byte range is the affected chunk, not the exact changed byte.” Last accessors: chronological Table with actorName, role, action, at; empty “No accessor details available”. Caption “Recent access is investigative context, not proof of responsibility.”

Anchor section: batchId, copyable root/txHash, pending/confirmed badge, “View on Polygon Amoy” link from explorerUrl (HTTPS allowlisted testnet explorer; new tab with noreferrer). No anchor → “No anchor receipt available”. Contract address, if later shown, must be `0x`-prefixed.

When originalVersionAvailable: show “Restore original (S3 Object Lock)”. Allowed author sees AlertDialog: “Create a new version from the locked original? The damaged version and audit history remain.” Require reason, disable during submission, use returned UploadReceipt, navigate to new document ID and re-verify. Unauthorized/read-only roles see disabled action and “An authorized document contributor must restore.” If false: no restore action; never promise that a locked original exists.

Restore never alters the original document row or deletes/rewrites an audit event. Backend retrieves the retained original S3 version, verifies it, creates a new signed encrypted document version with parentId = damaged document ID, and audits as UPLOAD. New version is UNANCHORED/PENDING_ANCHOR until confirmed. Old version remains red in the versions list. Full green requires fresh VerifyResult VERIFIED; operator may pre-arrange quick anchoring, never force the badge.

Persistent trust copy: “ML-DSA-65 signatures are verified off-chain by our backend verifier. Polygon stores hashes and the verifier’s attestation; it does not verify post-quantum signatures.”

## Design tokens (Tailwind v4 + shadcn)

Dark first, sober navy/slate; emerald reserved for verified, red for mismatch/denied, amber for pending. Use textual labels and icons with color; keyboard focus rings; >=44px touch targets; dialog focus restoration; live-region status announcements. Test contrast before implementation sign-off.

```css
/* Proposed app/globals.css variables, documentation only */
:root, .dark {
  color-scheme: dark;
  --background: #0b1220; --foreground: #e8edf5;
  --card: #111d30; --card-foreground: #e8edf5;
  --popover: #16243a; --popover-foreground: #e8edf5;
  --primary: #93c5fd; --primary-foreground: #0b1220;
  --secondary: #20304a; --secondary-foreground: #e8edf5;
  --muted: #19263b; --muted-foreground: #a9b8cd;
  --accent: #253b59; --accent-foreground: #e8edf5;
  --destructive: #fda4af; --destructive-foreground: #350d18;
  --border: #3e526e; --input: #536883; --ring: #93c5fd;
  --verified: #6ee7b7; --verified-surface: #0d302a;
  --tampered: #fda4af; --tampered-surface: #350d18;
  --pending: #fcd34d; --pending-surface: #35280d;
  --neutral: #b5c3d7; --neutral-surface: #20304a;
  --sidebar: #0e1829; --sidebar-foreground: #e8edf5;
  --sidebar-primary: #93c5fd; --sidebar-primary-foreground: #0b1220;
  --sidebar-accent: #253b59; --sidebar-accent-foreground: #e8edf5;
  --sidebar-border: #3e526e; --sidebar-ring: #93c5fd;
  --radius: 0.625rem;
}
@theme inline {
  --color-background: var(--background); --color-foreground: var(--foreground);
  --color-card: var(--card); --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover); --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary); --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary); --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted); --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent); --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive); --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border); --color-input: var(--input); --color-ring: var(--ring);
  --color-verified: var(--verified); --color-verified-surface: var(--verified-surface);
  --color-tampered: var(--tampered); --color-tampered-surface: var(--tampered-surface);
  --color-pending: var(--pending); --color-pending-surface: var(--pending-surface);
  --color-neutral: var(--neutral); --color-neutral-surface: var(--neutral-surface);
  --color-sidebar: var(--sidebar); --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary); --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent); --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border); --color-sidebar-ring: var(--sidebar-ring);
  --font-sans: 'Inter', 'Segoe UI', sans-serif;
  --font-mono: 'JetBrains Mono', Consolas, monospace;
  --radius-sm: calc(var(--radius) - 4px); --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius); --radius-xl: calc(var(--radius) + 4px);
}
```

Typography: page heading 24/32 semibold; section 18/28 semibold; body 14/22; metadata 12/18; hashes 12/20 mono (wrap full value in details; abbreviate table with copy button). Spacing: 4px unit; controls gap 8px, fields 12px, cards padding 20px, sections 24px; page padding 24px desktop/16px mobile. Tables 48px rows, 40px header. Borders 1px; subtle shadow only for popovers; no gradients or animated backgrounds.

## AWS & trust footer / badge strip

Always label “Protection architecture”; badges describe responsibilities, not live health or deployment assertions. Show a persistent “Demo data — simulated results” banner when fixtures are active.

| Badge | Tooltip / footer copy |
|---|---|
| Amazon Cognito | Authenticates users; roles and case attributes are enforced separately |
| Amazon RDS PostgreSQL + RLS | Restricts rows using authenticated identity and case permissions |
| Amazon S3 Object Lock | Preserves retained ciphertext versions; later current versions may still be corrupted |
| AWS KMS | Protects encryption key material; app-layer PQ algorithms run in the backend |
| EC2 + CloudFront | Hosts the application and serves HTTPS; evidence responses are not cached |
| Amazon Bedrock · bonus | Case-scoped answers with authorized citations; mark unavailable if not enabled |
| EventBridge / CloudTrail · optional | Scheduled scans / AWS access events; show as planned unless wired |
| Polygon Amoy · testnet | Public hash commitments and verifier attestation; separate from AWS |

Also show “AES-256-GCM · ML-KEM-768 · ML-DSA-65” and the off-chain verification disclaimer. No claim that KMS natively performs ML-DSA unless the implemented deployment confirms it. Assistant persistence must preserve zero plaintext at rest; cut it if authorized retrieval/encrypted text handling cannot be finished within four hours.

## Demo fixtures and failure behavior

Use wholly fictional people and records; no real FIR/personal data. Future mocks belong under `components/**/mocks.ts`, importing Claude's contract. No mock file is created in this planning pass.

| Fixture | Stable value / expected behavior |
|---|---|
| Assigned case | `11111111-1111-4111-8111-111111111111`; FIR `NSK/2026/0142`; Gangapur Police Station; stage Investigation; status Open |
| Unassigned case | `22222222-2222-4222-8222-222222222222`; FIR `NSK/2026/0187`; Panchavati Police Station; F denied even via direct link |
| FIR document | `33333333-3333-4333-8333-333333333333`; `FIR_0142.txt`; version 1; exactly 16,384 UTF-8 ASCII bytes; fictional seized-device narrative |
| Lab report | `44444444-4444-4444-8444-444444444444`; `Forensic_Report_0142.pdf`; version 1; 188,416 bytes |
| Actors | Inspector Aditi Patil (P), Dr. Neha Kulkarni (F), Adv. Rohan Deshmukh (R), Justice Meera Joshi (J), Demo Administrator (A) |
| Times | Upload `2026-10-10T05:00:00Z`; prosecutor VIEW `2026-10-10T05:02:00Z`; scan `2026-10-10T05:03:00Z` |
| Tamper result | TAMPERED; decrypt pass, plaintextHash fail, chunkRoot fail; other checks follow real verifier; range `{chunkIndex:2,byteStart:8192,byteEnd:12287,kind:'modified'}`; originalVersionAvailable true |
| Recovery | New UUID, version 2, parentId FIR document UUID; original retained and flagged; new result pending until anchor confirmed |

Synthetic offline hashes may use `0123456789abcdef` repeated four times (64 lowercase chars); fake chain values add `0x`. They are fixture placeholders, never evidence of a real anchor: omit clickable explorer links in offline UI. Live hashes, timestamps, roots, signatures and txHash must come from backend receipts, not these fixtures.

Fallback is explicit and isolated: “Live API unavailable. Open demo data” switches to a fully mocked view with every result/export marked simulated; never blend fake pass results into live evidence. A stale live result shows its prior check time. Keep prepared screenshots for denied/red/recovery scenes if a dependency fails. No claims of successful live restore/anchor when only a recording is available.
