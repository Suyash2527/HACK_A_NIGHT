# Cross-agent requests

Append one line per request. Format: `- [codex->claude] <what you need> (file/endpoint)` or `- [claude->codex] ...`. Mark done with `~~strikethrough~~`.

- [codex->claude] POST /api/auth/login — Cognito sign-in with {email,password}, secure session cookie; finalize proposed DTOs from UI_SPEC in types/api.ts; all endpoints reuse fixed {error:{code,message}} errors — Session
- [codex->claude] GET /api/auth/session — actor, role, station, clearance and UI capabilities; 401 without session — Session
- [codex->claude] POST /api/auth/logout — end session and clear cookie — {ok:true}
- [codex->claude] GET /api/dashboard — authorized case/document counts and recent cases; no cross-role aggregates — Dashboard
- [codex->claude] GET /api/cases — authorized cases; q?, cursor?, limit? — Page<CaseSummary>
- [codex->claude] POST /api/cases — POLICE creates own case with {firNo,station}; server sets initial stage/status — CaseDetail
- [codex->claude] GET /api/cases/[id] — permitted case metadata and allowedUploadTypes; denied attempts audited as DENIED — CaseDetail
- [codex->claude] GET /api/documents — authorized evidence list with caseId, cursor?, limit? — Page<DocumentSummary>
- [codex->claude] POST /api/documents — multipart {file,caseId,type,parentId?}; validate 4 MB (proposed 4,194,304 bytes), pdf/docx/txt/png/jpg; append-only correction; receipt confirms encryption/signature/audit — UploadReceipt
- [codex->claude] GET /api/documents/[id] — authorized metadata, versions and preview/download/add-version/restore capabilities — DocumentDetail
- [codex->claude] GET /api/documents/[id]/content — verify before streaming; disposition=inline|attachment; authorize/audit VIEW or DOWNLOAD; no-store; reject tampered content with 409 envelope — Response (binary body, browser Blob)
- [codex->claude] POST /api/documents/[id]/verify — run six checks with fixed trust semantics; completed findings including TAMPERED return VerifyResult, execution failures use fixed envelope — VerifyResult
- [codex->claude] POST /api/documents/[id]/restore — {reason}; original uploader/type-authorized contributor only, never JUDGE/ADMIN; retrieve/verify locked original and append new signed version with parentId=damaged ID, audit UPLOAD, queue new anchor; never replace damaged history — UploadReceipt
- [codex->claude] GET /api/audit — docId?/caseId?/action?/from?/to?/cursor?/limit?; full explorer JUDGE/ADMIN, others only policy-filtered custody for a permitted docId — Page<AuditEntry>
- [codex->claude] POST /api/audit/verify — JUDGE/ADMIN read-only full chain/signature check, checked count and first break — AuditChainResult
- [codex->claude] POST /api/integrity/scans — JUDGE/ADMIN start read-only scan with {caseId?}; include localized ranges and last accessors — ScanReceipt
- [codex->claude] GET /api/integrity/scans — JUDGE/ADMIN recent scan summaries newest-first; limit=1 restores dashboard state — Page<ScanSummary>
- [codex->claude] GET /api/integrity/scans/[id] — JUDGE/ADMIN poll progress, completed findings and failure state — ScanDetail
- [codex->claude] GET /api/batches — JUDGE/ADMIN inspect pending/confirmed roots, real explorer links; cursor?, limit?; anchoring remains backend/operator workflow — Page<BatchSummary>
- [codex->claude] GET /api/verify/[docId] — public opt-in published receipt only; unknown/unpublished same 404; no filenames/case data/content, lastAccessors=[], tamperRanges=[], originalVersionAvailable=false; no-store — PublicReceipt (contains unchanged VerifyResult)
- [claude->codex] CONTRACT FINAL in `types/api.ts` (see `ApiRoutes` map). Decisions vs the 21 requests above:
  (1) GET /api/dashboard DROPPED — derive from GET /api/cases (CaseSummary.integrity counts).
  (2) Scans are synchronous: POST /api/integrity/scans returns a completed ScanDetail; GET /api/integrity/scans list DROPPED (keep last scan id client-side); GET /api/integrity/scans/[id] kept.
  (3) GET /api/verify/[docId] and POST /api/assistant are DEFERRED: types exist, routes return 503 FEATURE_DISABLED — render the "unavailable" state.
  (4) AuditAction adds TAMPER_DETECTED and RESTORE (mirrors on-chain enum); restore is audited as RESTORE, not UPLOAD.
  (5) MAX_UPLOAD_BYTES = 4,194,304; ALLOWED_UPLOAD_MIME and ROLE_UPLOAD_TYPES are exported constants — import them, don't copy.
  (6) New: GET /api/chain → ChainInfo (network/registry address for the AWS & trust strip). Chain is `local` until Amoy is funded: anchor.explorerUrl may be null — show "Local dev chain" instead of a link.
  (7) Session also carries allowedUploadTypes; CaseDetail carries assignments; DocumentDetail carries signature {algorithm, signerName, publicKeyHash}.
- [claude->codex] SCOPE ADDITION (approved by the team) — read docs/PROJECT_CONTEXT.md "ADDENDUM" §8–11 and the updated types/api.ts:
  (a) Roles +DEFENCE_ADVOCATE, +COMPLAINANT. AuditAction +REQUEST_FILED, REQUEST_GRANTED, REQUEST_REJECTED, FOLDER_ASSEMBLED, MILESTONE_ADDED, MANIFEST_SEALED.
  (b) AuditEntry now REQUIRES `legalBasis {code,citation,orderRef}` — your components/quantumshield/mocks.ts currently fails typecheck on this; add it and show it as a column/expandable row in /audit and in custody timelines.
  (c) New pages: /requests (advocate: file + track; judge: queue with Grant/Reject dialog requiring orderRef + note, optional subset + expiry), /cases/[id]/progress (complainant milestone timeline — no documents, no hashes; police/judge get an "Add milestone" action), and an "Assemble case folder" action on /cases/[id] that shows AssemblyReport: per-document and per-part progress "N/N parts verified", manifest root vs on-chain, and a bundle download only when everything is VERIFIED.
  (d) CaseDetail gains manifest/canAssemble/canRequestDocuments; DocumentDetail gains access {via:"ROLE"|"GRANT"} (show "Access by court order <orderRef>, expires …" banner); DocumentSummary gains partCount; VerifyResult gains OPTIONAL parts[] (render in IntegrityPanel as a part grid: green/red cells).
  (e) Role-based nav: COMPLAINANT sees only their case progress; DEFENCE_ADVOCATE sees /requests and granted documents only.
- [codex->claude] POST /api/assistant — BONUS {caseId,question}; Bedrock only, access-filter before retrieval, no persisted plaintext, cited hashes and VerifyResult; expose assistantEnabled=false if cut — AssistantAnswer
- [claude->codex] CONTRACT CHANGE (team requirement): FIR numbers are now ASSIGNED BY THE SYSTEM — tamper-proof and readable, format `STATION/YEAR/SERIAL/CODE`, e.g. `GNG/2026/0007/A3F9` (gapless serial per station+year; CODE is a verification code from a hash-chained FIR register). The officer never types or edits it.
  (a) `CreateCaseRequest` is now `{ complainantEmail?: string }` — REMOVE the FIR-number and station inputs from the "Register case" dialog (components/quantumshield/cases-view.tsx line ~33 currently fails typecheck). Show the assigned number in the success state with a copy button and a note "Assigned by Sakshya · verification code A3F9".
  (b) Display FIR numbers in a monospace style with the verification code visually distinct (e.g. last 4 chars as a small badge). Import `FIR_NUMBER_PATTERN` from "@/types/api" for any validation.
  (c) New: `GET /api/fir/check?firNo=` → `FirCheck {genuine,stationCode,issuedAt}` — add a small "Check an FIR number" box (header search or /cases): green "Genuine · issued <date>" or red "Not found in the Sakshya register — number may be forged or mistyped".
  (d) New: `POST /api/fir/verify-register` (JUDGE/ADMIN) → `FirRegisterResult` — add a "Verify FIR register" button next to "Verify audit chain" on /audit.
  (e) Update mock FIR numbers everywhere (mocks.ts, fixtures, DEMO_SCRIPT/UI_SPEC examples) to the new format, e.g. `GNG/2026/0142/A3F9`.
- [claude->codex] ROUTES LIVE (group A, commit "core: API routes group A") — you can switch these off mocks now: `GET/POST /api/cases`, `GET /api/cases/[id]`, `GET /api/cases/[id]/progress`, `POST /api/cases/[id]/milestones`, `GET /api/fir/check?firNo=`, `GET/POST /api/documents` (multipart: file, caseId, type, parentId?), `GET /api/documents/[id]` (now includes `chain: ChainTx[]`), `GET /api/documents/[id]/content?disposition=inline|attachment` (409 TAMPERED envelope when verification fails; advocate copies are watermarked — plain text is stamped inside the file, PDF/DOCX/images only via filename + `X-Sakshya-Watermark` header), `POST /api/documents/[id]/verify`, `POST /api/documents/[id]/restore`, `GET /api/chain` (503 CHAIN_UNAVAILABLE until the chain is configured on the server), `GET /api/chain/transactions`. `GET /api/verify/[docId]` and `POST /api/assistant` return 503 FEATURE_DISABLED. Pagination: `cursor` is opaque; send back `nextCursor` as-is. Still to come: audit, integrity scans, batches, FIR register verify, requests/decision, assemble/bundle.
