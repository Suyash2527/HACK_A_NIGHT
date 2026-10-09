# Sakshya

Tamper-evident, quantum-safe evidence system for courts and police. One FIR is one case folder; every document is encrypted, signed, audited and anchored on a public blockchain, so a single changed byte is detected, located and recoverable.

Live demo: https://3-109-114-12.sslip.io (fictional data only) · Hack-a-Night, PVGCOE Nashik, problem statement 3.

## What it does

- **Encrypts every document in 64 KiB parts** with AES-256-GCM. The file key is wrapped with **ML-KEM-768**. Parts are stored by their SHA-256 in S3 with Object Lock, so the original of any part is always retained.
- **Signs each document with ML-DSA-65** (post-quantum). The signature is checked off-chain by our backend. The chain stores hashes and the verifier's attestation; it does not verify post-quantum signatures itself.
- **Detects and locates tampering.** Six checks run on every read: authenticated decryption, content hash, 4 KiB chunk Merkle root, signature, Merkle proof into an anchored batch, and that batch root against the root stored on Sepolia. A changed byte is reported as "chunk 2, bytes 8192–12287" and the content is withheld.
- **Restores without rewriting history.** A restore appends a new signed version from the locked original; the damaged version stays red.
- **Keeps a hash-chained audit log** where every entry records a legal basis (investigation, court order, statutory disclosure…). The chain is computed inside the database.
- **Assigns FIR numbers itself** (`GNG/2026/0007/A3F9`): gapless per station and year, with a verification code from a hash-chained register, so a forged number cannot validate.
- **Court workflow.** A defence advocate looks up a case by FIR number and files a request; a judge grants specific documents with an order reference and an expiry; the advocate's copies are watermarked. A complainant sees only a milestone timeline. The court can assemble a case folder; a ZIP bundle is offered only when every current document is VERIFIED.

## Architecture

Next.js 16 (App Router) on EC2 behind Caddy HTTPS · Amazon Cognito · RDS PostgreSQL 17 with forced row-level security · S3 (Object Lock) · KMS · Ethereum Sepolia (`SakshyaRegistry`, `contracts/`). Diagram and trust boundaries: [docs/architecture/Sakshya_Architecture.pdf](docs/architecture/Sakshya_Architecture.pdf). Spec: [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md).

```
lib/            crypto (pqc, parts), merkle, storage, evidence, audit, cases, requests, assembly, anchoring, chain, db
app/api/        thin route handlers over lib/ (contract: types/api.ts)
db/             schema.sql + idempotent patches/ ; row-level security, append-only triggers
contracts/      SakshyaRegistry.sol (Hardhat 3) and deployment records
infra/          PowerShell scripts for AWS setup and deploy
scripts/        importer, anchoring, live smoke tests
tests/          in-process route and library tests (real RLS via embedded Postgres)
```

## Run it locally

```bash
npm install
npm run init:env      # creates .env.local with fresh secrets (never committed)
npm run dev           # embedded Postgres in .data/, local folder for parts, no chain
npm run test:unit     # 133 tests
```

Demo accounts (all `@sakshya.demo`): `police`, `police2`, `police3`, `lab`, `prosecutor`, `judge`, `admin`, `advocate`, `complainant`. The shared password is `DEMO_PASSWORD` in `.env.local`.

Other commands: `npm run typecheck`, `npm run lint`, `npm run import:cases -- data/cases` (load the 40 fictional cases locally), `npm run anchor` (anchor on demand when a chain is configured), `cd contracts && npx hardhat test`.

## Deploy and verify

```powershell
.\infra\06-deploy.ps1 -Migrate        # build, upload, migrate (idempotent patches), restart
.\infra\08-import-data.ps1            # load data/cases onto the server (run once)
npx tsx scripts/e2e-live.mts https://3-109-114-12.sslip.io    # upload → denial → on-chain verify → attack → restore → bundle
npx tsx scripts/smoke-live.mts https://3-109-114-12.sslip.io  # imported data, advocate grant flow, bundle
```

## Honest limits

- The chain is a public testnet. It proves that hashes existed at a time and were not changed afterwards; it does not hide or verify post-quantum signatures.
- Whoever holds the system key and write access to storage can re-encrypt a part validly. That is exactly the attack the demo shows being detected, because the signed hashes, chunk tree and part addresses no longer match.
- Advocate copies: plain text is stamped inside the file; PDF, Word and image copies are marked by file name and response header only.
- The Bedrock assistant and public verify receipts are not built (the routes answer 503 `FEATURE_DISABLED`).
- All data is fictional.
