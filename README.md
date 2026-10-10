# Sakshya

**Tamper-evident, quantum-safe evidence management for police, forensic labs and courts.**

One FIR is one case folder. Every document in it is encrypted, signed with a post-quantum key, written to an append-only audit trail and anchored on a public blockchain. If a single byte changes, Sakshya detects it, shows exactly where, withholds the damaged copy and restores the locked original as a new version.

- **Live demo:** https://3-109-114-12.sslip.io (fictional data only)
- **Event:** Hack-a-Night 2026, PVGCOE Nashik, problem statement 3
- **Languages:** English, हिन्दी, मराठी

---

## Contents

- [The problem](#the-problem)
- [What Sakshya does](#what-sakshya-does)
- [Who uses it](#who-uses-it)
- [How a document is protected](#how-a-document-is-protected)
- [Architecture](#architecture)
- [Run it locally](#run-it-locally)
- [Deploy and verify](#deploy-and-verify)
- [Demo in five minutes](#demo-in-five-minutes)
- [Repository layout](#repository-layout)
- [Honest limits](#honest-limits)
- [Credits](#credits)

---

## The problem

Case records in India still move through paper files, shared drives and email. Nobody can say with confidence:

- who submitted a document, and when;
- whether it has been changed since;
- who has seen it, and on what legal authority;
- which copy is the original.

A one-byte change in a 16 KB statement is 0.006% of the file, which is invisible to a reader but enough to change a name, a time or a vehicle number. Sakshya makes that change visible and recoverable.

## What Sakshya does

| Capability | How |
|---|---|
| **Encrypts everything** | Each file is split into 64 KiB parts and encrypted with AES-256-GCM. The file key is wrapped with **ML-KEM-768** (post-quantum). No plaintext is ever written to disk or the database. |
| **Signs every document** | **ML-DSA-65** (post-quantum) signature over the document's hashes, case, type and version. Verified by the backend on every read. |
| **Detects and locates tampering** | Six checks on every read (below). A failure is reported as, for example, *"chunk 2, bytes 8192–12287"*, and the content is withheld. |
| **Restores without rewriting history** | Parts are stored by SHA-256 in S3 with **Object Lock**, so the original is always retained. A restore appends a new signed version; the damaged version stays on record in red. |
| **Keeps an unforgeable audit trail** | Every view, download, upload, denial and decision is a hash-chained entry that records its **legal basis** (investigation, court order, statutory disclosure…). The chain is computed inside the database; edits and deletes are blocked by triggers. |
| **Issues FIR numbers itself** | `GNG/2026/0007/A3F9`: gapless per station and year, with a check code from a hash-chained register, so a forged number fails validation. |
| **Anchors on a public chain** | Document hashes are batched into Merkle trees and the roots are written to Ethereum Sepolia (`SakshyaRegistry`). Tamper detections are published there too, so a finding cannot be quietly erased. |
| **Runs the court workflow** | A defence advocate requests documents by FIR number. A judge grants specific ones with an order reference and expiry. The advocate's copies are watermarked. The court can assemble the case folder into a bundle. |

## Who uses it

Access is enforced twice: once by the API, and again by PostgreSQL **row-level security**, so even a bug in a route cannot leak another case.

| Role | Can upload | Sees |
|---|---|---|
| Police | FIR, witness statements | Cases assigned to them |
| Forensic lab | Forensic reports | Cases assigned to them |
| Public prosecutor | Charge sheet | Cases assigned to them |
| Judge / Admin | — | Every case; runs integrity scans, decides requests, verifies the audit chain (restores are done by the uploader's role, never the court) |
| Defence advocate | — | Only documents a judge has granted, until the grant expires (watermarked) |
| Complainant | — | A milestone timeline of their own case, never the documents |

Demo accounts (all `@sakshya.demo`): `police`, `police2`, `police3`, `lab`, `prosecutor`, `judge`, `admin`, `advocate`, `complainant`. The shared password is `DEMO_PASSWORD` in `.env.local`.

## How a document is protected

```
upload ─► hash (SHA-256) + 4 KiB chunk Merkle tree
       ─► encrypt 64 KiB parts (AES-256-GCM), wrap key (ML-KEM-768)
       ─► store parts in S3 by address, Object Lock retains originals
       ─► sign hashes (ML-DSA-65)  ─► audit entry  ─► case manifest sealed
       ─► batched into a Merkle root ─► anchored on Sepolia
```

Every read runs the same six checks, and content is released only if they pass:

| # | Check | Catches |
|---|---|---|
| 1 | Authenticated decryption | Any change to stored ciphertext |
| 2 | Plaintext SHA-256 vs signed value | A validly re-encrypted but altered file |
| 3 | 4 KiB chunk Merkle root | The same, and pinpoints *which* chunk changed |
| 4 | ML-DSA-65 signature | Altered hashes or metadata in the database |
| 5 | Merkle proof into the anchored batch | A document swapped after anchoring |
| 6 | Batch root vs the root on-chain | A rewritten batch in our own database |

Status shown everywhere: **VERIFIED** (green), **PENDING_ANCHOR** / **UNANCHORED** (amber, waiting for the next batch), **TAMPERED** (red).

## Architecture

| Layer | Service |
|---|---|
| App | Next.js 16 (App Router) on EC2 behind Caddy HTTPS |
| Identity | Amazon Cognito; signed session cookie |
| Database | Amazon RDS PostgreSQL 17, forced row-level security, append-only triggers, hash-chained audit |
| Files | Amazon S3 private bucket, content-addressed parts, SSE-KMS, versioning + Object Lock |
| Keys | AWS KMS; ML-KEM-768 / ML-DSA-65 via `@noble/post-quantum` |
| Chain | Ethereum Sepolia, `SakshyaRegistry.sol` (Hardhat 3) |

- **Diagram and trust boundaries:** [docs/architecture/Sakshya_Architecture.pdf](docs/architecture/Sakshya_Architecture.pdf)
- **Full specification:** [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md)
- **API contract:** every request and response shape is in [`types/api.ts`](types/api.ts)

## Run it locally

You need Node.js 22.10 or newer. No AWS account is needed locally: it uses an embedded Postgres in `.data/`, a local folder for file parts, and no chain.

```bash
npm install
npm run init:env        # writes .env.local with fresh secrets (never committed)
npm run dev             # http://localhost:3000
```

Load the fictional cases (optional):

```bash
npm run import:cases -- data/cases
```

Checks:

```bash
npm run test:unit       # crypto, Merkle, RLS, routes, tamper
npm run typecheck
npm run lint
npm run build
cd contracts && npx hardhat test
```

Every variable is documented in [`.env.example`](.env.example).

## Deploy and verify

AWS setup is scripted in `infra/` (`01-core` → `07-https`). To ship a new build:

```powershell
.\infra\06-deploy.ps1 -Migrate        # build, upload, apply idempotent DB patches, restart
.\infra\08-import-data.ps1            # load data/cases onto the server (once)
```

End-to-end checks against the live site:

```bash
# upload → denial → on-chain verify → insider attack → restore → bundle
npx tsx scripts/e2e-live.mts https://3-109-114-12.sslip.io

# imported data, advocate request and grant, bundle
npx tsx scripts/smoke-live.mts https://3-109-114-12.sslip.io
```

## Demo in five minutes

Full script: [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

1. **Police** registers an FIR in the browser. The system issues the FIR number, then encrypts, signs and audits the record.
2. **Forensic lab** tries to open an unassigned case and is **denied**. The denial is itself audited.
3. **Judge** verifies a document: six green checks, with a link to the on-chain anchor.
4. An **insider flips one byte** in storage (`scripts/demo-attack.ps1`). The next scan turns the document **red** and names the chunk and byte range.
5. The judge's case brief says *"Do not rely on…"* for the damaged copy. The **uploading officer restores** the locked original as a new signed version, and it verifies green again.
6. **Advocate** looks up the FIR, gets suggested documents and legal basis, and files a request. The **judge** grants it with an order reference, and the advocate downloads a watermarked copy.

## Repository layout

```
app/            pages (court-register UI) and app/api/ route handlers
components/     UI components, i18n (en / hi / mr)
lib/            crypto (pqc, parts), merkle, storage, evidence, audit, cases,
                requests, assembly, anchoring, chain, db
types/api.ts    the API contract shared by server and UI
db/             schema.sql + idempotent patches/ (RLS, triggers, audit chain)
contracts/      SakshyaRegistry.sol, tests and deployment records
infra/          PowerShell scripts for AWS setup and deploy
scripts/        case importer, anchoring, live end-to-end and smoke tests
data/           fictional case sets (PDF)
tests/          library and route tests on embedded Postgres with real RLS
docs/           spec, architecture, demo script, pitch, test report
```

## Honest limits

- **The chain is a public testnet.** It proves that hashes existed at a point in time and were not changed afterwards. It does not verify post-quantum signatures, and Ethereum's own signatures are not quantum-safe.
- **Trusted keys:** whoever holds the system key and write access to storage can re-encrypt a part validly. That is exactly the attack the demo shows being detected, because the signed hashes, chunk tree and part addresses no longer match.
- **Watermarking:** advocate copies of plain text are stamped inside the file; PDF, Word and image copies are marked by file name and response header only.
- **Not built:** public verification receipts (`/api/verify/[docId]` returns 503 `FEATURE_DISABLED`).
- **Data:** all case data is fictional.
