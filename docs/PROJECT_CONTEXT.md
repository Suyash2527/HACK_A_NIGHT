# PROJECT CONTEXT: Hack-a-Night 2026 (24-hour hackathon, PVGCOE Nashik)
Submission deadline: Saturday 10 Oct 2026, 12:00 PM IST (code freeze).
Judging favours a working, live, demo-able prototype over unfinished ambition.

## PROBLEM STATEMENT (PS 3)
Tamper-Evident, Quantum-Safe, Zero-Trust Judicial & Forensic Document Management System
Domain: LegalTech / Cryptographic Data Management / Chain of Custody

Law enforcement agencies, forensic labs and judicial bodies handle mission-critical
case records (FIRs, witness testimonies, charge sheets, forensic findings) using
fragmented legacy systems and physical paperwork, exposing evidence to undetected
tampering. Court records must also remain trustworthy for decades, so classical
crypto (RSA/ECDSA) is at risk from future quantum computers
("harvest now, decrypt later").

## OBJECTIVE
A tamper-evident, zero-trust DMS for investigative and legal pipelines that:
1. Centralises and digitises sensitive case records with encrypted ingestion.
2. Enforces strict granular access control (RBAC + ABAC).
3. Provides cryptographic proof of integrity via Merkle trees anchored on a blockchain.
4. Maintains an immutable, chronological, hash-chained audit trail.
5. Detects bit-level tampering and pinpoints where it happened.
6. Uses post-quantum cryptography (NIST standards) for key wrapping and signatures.

## TECH STACK — DECISION 2026-10-09: FULL AWS (AWS sponsor track). No Supabase, no Vercel, no Gemini.
AWS services must be visible in the demo and pitch. Wherever this document below still says
"Supabase", read it as the AWS equivalent in this table.
- Frontend: Next.js 16 (App Router, TypeScript) + Tailwind CSS + shadcn/ui
- Backend: Next.js API route handlers (Node runtime)
- Hosting: AWS (EC2 + CloudFront HTTPS, or Amplify Hosting — final pick in docs/PREREQS.md)
- Database: Amazon RDS for PostgreSQL 17 + pgvector, **Postgres Row-Level Security** enforced in-DB
  (server sets `app.user_id` per transaction; replaces Supabase `auth.uid()`)
- Auth: Amazon Cognito user pool (seeded demo users, one per role); role/ABAC attributes in RDS `users`
- File storage: Amazon S3 private bucket, ciphertext only, SSE-KMS, versioning + Object Lock (WORM)
- Key management: AWS KMS (master key protecting PQC secrets; ML-DSA system signer if supported)
- Classical crypto: Node `crypto` (AES-256-GCM, SHA-256, HKDF)
- Post-quantum crypto: `@noble/post-quantum` (ML-KEM-768, ML-DSA-65)
- Merkle trees: `merkletreejs`
- Blockchain: Solidity contract on Polygon Amoy testnet (Hardhat + ethers.js)
- AI (bonus): Amazon Bedrock (Titan Text Embeddings v2 + a Claude/Nova model) with pgvector
- Scheduled integrity scan: Amazon EventBridge Scheduler; KMS/S3 access trail: AWS CloudTrail

## CORE MODULES

### 1. Secure Encrypted Ingestion
- Every uploaded file gets a random 256-bit Data Encryption Key (DEK).
- File encrypted with AES-256-GCM (store iv + auth tag). Only ciphertext is stored.
- SHA-256 of the plaintext computed before encryption and stored.
- DEK wrapping (quantum-safe envelope encryption):
  system ML-KEM-768 keypair -> encapsulate -> shared secret -> HKDF-SHA256 -> KEK
  -> AES-256-GCM wrap DEK. Store KEM ciphertext + wrapped DEK per document.
  ML-KEM private key lives in env vars (note Cloud KMS/HSM as the production path).
- No plaintext ever touches storage or the DB.

### 2. Post-Quantum Signatures (ML-DSA-65)
- Each user has an ML-DSA-65 keypair (generated at seed; private keys stored
  encrypted with the master key — demo simplification).
- Uploader signs: { sha256, chunkRoot, caseId, docType, version, timestamp }.
- System ML-DSA key signs every audit-log entry and every Merkle batch root.
- Verification of signatures shown in the UI (non-repudiation).

### 3. Merkle Integrity Ledger
- Per-document chunk tree: split plaintext into 4 KB chunks, SHA-256 each,
  build Merkle tree -> chunkRoot. Used to localise tampering to an exact chunk/byte range.
- System batch tree: every N uploads (or on demand), build a Merkle tree of
  document leaf hashes -> batch root.
- Anchor batch root on Polygon Amoy via smart contract storing:
  batchId, root (bytes32), timestamp, keccak/sha256 hash of the ML-DSA signature.
  Full ML-DSA signature stored off-chain in DB.
- Store each document's Merkle proof + batchId + tx hash.
- UI shows "Verified" badge with proof, signature status and explorer link.

### 4. Zero-Trust Access Control (RBAC + ABAC)
Roles:
- POLICE (Investigating Officer): create cases, upload FIR / witness statements
  for own cases.
- FORENSIC_LAB: view evidence lists and upload forensic reports ONLY for
  assigned cases.
- PUBLIC_PROSECUTOR: read full case file for assigned cases, upload charge sheets.
- JUDGE / ADMIN: read-only on all cases, full audit and integrity views.
ABAC attributes: case assignment, police station/jurisdiction, document type,
case stage, clearance level.
Rules:
- Enforced in BOTH API layer and Postgres (RDS) RLS policies.
- Documents are append-only: no edit, no delete. Corrections = new version
  linked via parent_id.
- Every request verified; every denied access attempt is logged.

### 5. Immutable Audit Trail
- audit_log entries: actor, action (UPLOAD/VIEW/DOWNLOAD/VERIFY/DENIED/ANCHOR/
  SCAN), doc_id, case_id, timestamp, prev_hash, entry_hash, ml_dsa_signature.
- entry_hash = SHA-256(prev_hash + entry data) -> hash chain.
- "Verify audit chain" feature recomputes the chain and highlights any break.
- Per-document chain-of-custody timeline view.

### 6. Tamper Detector
- On every view: decrypt -> recompute SHA-256 -> compare to stored hash ->
  verify Merkle proof against on-chain root -> verify ML-DSA signature.
- Integrity scan (button + scheduled) across all documents.
- On mismatch: red alert showing document, tampered chunk index / byte range
  (via chunk tree diff), and last actors who accessed it.
- Include a demo script that flips one byte of a stored ciphertext/plaintext
  to simulate an insider attack.

### 7. RAG Case Assistant (BONUS — lowest priority)
- Extract text from documents, chunk, embed with Gemini, store in pgvector
  with case_id + allowed roles metadata.
- Filter by the requesting user's access BEFORE retrieval (no leakage).
- Answers cite source documents with their hash and verification status.

## ADDENDUM 2026-10-09 — case folders, sharded storage, court requests, complainant view (APPROVED SCOPE)
Contract: `types/api.ts` (authoritative). On-chain: `sealCaseManifest` + case-level audit events.

### 8. Case folder + sharded, content-addressed storage
- One FIR = one case folder holding every document (police, forensic, prosecution).
- Each document is split into 64 KiB parts; each part encrypted separately (AES-256-GCM, document DEK,
  AAD = docId|partIndex|partCount) and stored in S3 as `iv‖ciphertext‖tag` under key `parts/<sha256(object)>`
  (content-addressed). DB keeps the ordered part addresses. 4 KiB Merkle chunks over plaintext stay as before.
- Tampering with any stored part → its bytes no longer hash to its address → "document X, part N altered"
  without decrypting; the plaintext chunk diff then pinpoints the byte range.
- Case manifest = Merkle root over all document leaves of the case; a new version is sealed on-chain
  (`sealCaseManifest`) whenever a document is added. Folder can only grow.
- "Assemble case folder" (court / prosecutor; advocate only over granted documents): fetch every part,
  verify address + GCM, rebuild each document, verify sha256/chunkRoot/ML-DSA signature, recompute the
  manifest root and compare with the on-chain root → ZIP bundle (files + manifest.json + hash certificate)
  only if everything is VERIFIED. Assembly is audited (FOLDER_ASSEMBLED).

### 9. Defence advocate document requests (court-controlled access)
- New role DEFENCE_ADVOCATE: no access to case documents by role — ONLY via a granted DocumentRequest.
- Advocate files a request: documents, legal basis (code + citation text, e.g. statutory right to copies),
  reason. JUDGE grants (optionally a subset, optional expiry, order reference + note) or rejects.
- Grant = view + watermarked download (advocate name, order ref, document sha256, timestamp stamped on the
  copy). Every access through a grant is audited with legalBasis = COURT_ORDER + orderRef.
- REQUEST_FILED / REQUEST_GRANTED / REQUEST_REJECTED are hash-chained and logged on-chain against the case.

### 10. Complainant progress view
- New role COMPLAINANT linked to their own case only. Sees the milestone timeline
  (FIR_REGISTERED → INVESTIGATION → FORENSIC_ANALYSIS → CHARGE_SHEET_FILED → TRIAL → JUDGMENT → CLOSED)
  with dates and public-safe notes. Never sees documents, hashes of evidence, or other parties' identities.
- Milestones are added by the investigating officer or the court (MILESTONE_ADDED, audited).

### 11. Legal basis on every audit entry
- Every audit entry records `legalBasis {code, citation, orderRef}` and it is part of the hashed entry,
  so the reason for an access cannot be edited later. Court-granted access requires citation + orderRef.
- Legal citations are entered by users and recorded verbatim; the system does not interpret law.
  (Team note: confirm statute section numbers with a legal mentor before quoting them in the pitch.)

## DATABASE SCHEMA (Amazon RDS PostgreSQL)
- users(id = Cognito sub, name, email, role, station, clearance, mldsa_public_key,
  mldsa_private_key_enc)
- cases(id, fir_no, station, stage, status, created_by, created_at)
- case_assignments(case_id, user_id, role)
- documents(id, case_id, type, version, parent_id, uploader_id, sha256,
  chunk_root, chunk_hashes jsonb, storage_path, iv, auth_tag, kem_ciphertext,
  wrapped_dek, dek_iv, dek_tag, uploader_signature, batch_id, merkle_proof jsonb,
  created_at)
- merkle_batches(id, root, mldsa_signature, tx_hash, anchored_at)
- audit_log(id, actor_id, action, doc_id, case_id, ts, prev_hash, entry_hash,
  signature)
- doc_embeddings(id, doc_id, case_id, allowed_roles text[], chunk_text,
  embedding vector)

## UI / PAGES
- Login (seeded demo users, one per role) + role-specific dashboard
- Case list and case detail (documents, versions, verification badges)
- Upload document flow (shows hash, encryption, signature, audit entry)
- Document viewer with live integrity verification panel
- Chain-of-custody timeline per document
- Audit log explorer + "Verify chain"
- Integrity scan dashboard with tamper alerts
- Merkle batches page with on-chain anchors (explorer links)
- AI assistant panel (bonus)
Design: clean, professional, dark-mode-friendly government/legal look;
responsive; clear green (verified) / red (tampered) states.

## NON-FUNCTIONAL REQUIREMENTS
- Zero plaintext at rest; secrets only in env vars (.env.example provided).
- Typed, modular code: /lib/crypto, /lib/pqc, /lib/merkle, /lib/audit,
  /lib/access, /contracts.
- Seed script with realistic Indian demo data (FIRs, witness statements,
  forensic reports, charge sheets across 2–3 cases).
- Works end-to-end on the deployed AWS URL.
- README: problem, solution, architecture diagram (mermaid), tech stack,
  setup steps, demo credentials, screenshots.

## PRIORITY ORDER (MVP FIRST)
1. Auth + roles + schema + RLS
2. Encrypted upload/view with SHA-256 verification
3. Hash-chained audit log
4. Chunk Merkle tree + tamper detector
5. ML-KEM key wrapping + ML-DSA signatures
6. Batch Merkle + Polygon Amoy anchoring
7. UI polish + chain-of-custody timeline
8. RAG assistant (bonus)

## DEMO SCENARIO TO SUPPORT
1. Police uploads FIR -> hash, ciphertext in storage, signature, audit entry shown.
2. Forensic Lab tries unassigned case -> Access Denied (logged); uploads report
   on assigned case.
3. Prosecutor opens case -> Verified badge, Merkle proof, PQ signature valid,
   on-chain tx link.
4. Insider attack script flips one byte -> integrity scan shows red alert with
   exact chunk and last accessors.
5. AI assistant answers a case question with verified citations.
