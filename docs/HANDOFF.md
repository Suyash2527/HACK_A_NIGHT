# Sakshya — handoff (written Fri 9 Oct 2026, 22:50 IST)

**Hard deadline: Sat 10 Oct 2026, 12:00 IST (code freeze).** Hackathon: Hack-a-Night, PVGCOE Nashik, PS 3. A working, live demo beats unfinished scope.
Plan: freeze features ≈ 06:00 Sat; 06:00–12:00 = deploy, bug-fix, two rehearsals. No new features after that.

## What Sakshya is
Tamper-evident, quantum-safe, zero-trust judicial & forensic document system. One FIR = one **case folder**; every document is encrypted in 64 KiB parts (AES-256-GCM, key wrapped with **ML-KEM-768**), signed with **ML-DSA-65**, stored content-addressed (S3 Object Lock keeps originals), recorded in a hash-chained audit log with a **legal basis**, and committed on **Ethereum Sepolia** (`SakshyaRegistry`). An insider who edits one byte is detected and located ("chunk 2, bytes 8192–12287"), content is withheld, and the original can be restored as a **new version**. Full spec: `docs/PROJECT_CONTEXT.md` (read the ADDENDUM §8–11). Diagram/PDF: `docs/architecture/Sakshya_Architecture.pdf`.

## Roles (7) — the 4 main logins are POLICE, FORENSIC_LAB, COURT (JUDGE + PUBLIC_PROSECUTOR), ADMIN
Plus DEFENCE_ADVOCATE (sees documents only through a judge's grant) and COMPLAINANT (milestone timeline only, never documents).
Demo accounts (all `@sakshya.demo`): police, police2, police3 (stations GNG/PCV/NSR), lab, prosecutor, judge, admin, advocate, complainant. Password = `DEMO_PASSWORD` in `.env.local` (git-ignored; never print or commit it). Cognito holds the same accounts; roles/stations always come from OUR database by email.

## FIR numbers are assigned by the system (never typed)
`GNG/2026/0007/A3F9` = station / year / serial (gapless per station+year) / verification code from a hash-chained FIR register (`create_case()`, `check_fir_number()`, `verify_fir_register()` in `db/schema.sql`).

## Repo map and OWNERSHIP (two AIs share one working tree — stay in your lane)
| Owner | Paths |
|---|---|
| **Claude Code** | `lib/**`, `app/api/**`, `db/**`, `infra/**`, `contracts/**`, `scripts/**`, `tests/**`, `types/api.ts`, `next.config.ts`, `package.json`, `.env.example` |
| **Codex (UI)** | `app/**` pages/layouts EXCEPT `app/api/**`, `components/**`, `app/globals.css`, `public/**`, `docs/UI_SPEC.md`, `docs/DEMO_SCRIPT.md`, `docs/PITCH.md` |
| Shared | `docs/REQUESTS.md` — append one line per cross-agent request (`[codex->claude]` / `[claude->codex]`); `docs/HANDOFF.md` |

`types/api.ts` is THE API contract (`ApiRoutes` map, roles, `VerifyResult`, `ChainTx`, FIR types, `MAX_UPLOAD_BYTES`…). UI imports it; never redefine shapes. Conventions: hashes = 64-char lowercase hex, no `0x` (chain values `0x`-prefixed); dates ISO-8601 UTC; errors `{error:{code,message}}` with UNAUTHENTICATED 401, FORBIDDEN 403 (also audited as DENIED), NOT_FOUND 404, TAMPERED 409, TOO_LARGE 413, VALIDATION 422, CHAIN_UNAVAILABLE/FEATURE_DISABLED 503. Never show green unless status is VERIFIED. Trust copy must stay honest: ML-DSA is verified OFF-chain by our backend; the chain stores hashes + the verifier's attestation, it does not verify post-quantum signatures.

## State of the code (all committed; `git log`)
**Done & tested (100 unit tests + 33 contract tests; `npm run test:unit`, `cd contracts && npx hardhat test`):**
- `lib/crypto/pqc.ts`, `parts.ts` — ML-KEM/ML-DSA/AES-GCM, sharded sealing, `openDocument` (per-part states; `diagnosticPlaintext` for tamper localisation).
- `lib/merkle.ts`, `lib/storage/{part-store,s3-part-store}.ts` — chunk trees, tamper ranges, content-addressed store (local folder or S3 with retained originals).
- `lib/evidence.ts` — `uploadDocument`, `verifyDocumentById` (six checks), `readContent` (verifies first, 409 TAMPERED), `restoreDocument`, `getDocumentDetail`, `listCaseDocuments`. `lib/demo-attack.ts` — insider attack (flip one plaintext byte, valid re-encryption) for the demo.
- `lib/db.ts` (PGlite locally / `pg` → RDS when `DATABASE_URL` set), `lib/audit.ts`, `lib/policy.ts`, `lib/errors.ts`, `lib/session.ts`, `lib/cognito.ts`, `lib/chain.ts` (serial queue; each tx waits for confirmation; `chain_txs` table = live feed), `lib/import-cases.ts`.
- `db/schema.sql` — RLS (FORCE), append-only triggers, audit hash chain computed IN the database, FIR register, court grants (`request_catalog`, `add_milestone`, `create_case`…).
- **API routes that exist:** only `app/api/auth/{login,session,logout}`. Everything else the UI shows is still MOCK DATA.
- Contract `SakshyaRegistry` deployed on **Sepolia** at `0x149A343Edc8da1edDb170E5308aBfe28C5BC4fDA` (see `contracts/deployments/sepolia.md`). `npm run chain:e2e` proved 8 real confirmed transactions (register, attest, seal folder, tamper event, restore…).

**AWS (ap-south-1, credits active):** KMS (master + `ML_DSA_65` signer), S3 evidence bucket (Object Lock+versioning), private RDS PostgreSQL 17, Cognito pool, EC2 `t3.small` (SSM, no SSH, no keys), Elastic IP + Caddy auto-HTTPS. CloudFront is blocked (new account needs AWS Support verification) — we use Caddy.
**Live URL:** https://3-109-114-12.sslip.io (login works end-to-end: Cognito → RDS → session; UI still mock).
Scripts (PowerShell, re-runnable): `infra/01-core … 07-https.ps1`; **deploy = `.\infra\06-deploy.ps1`** (`-Migrate` first time or after schema change, `-SkipBuild`). AWS CLI is `& "C:\Users\Predator\AppData\Roaming\Python\Python313\Scripts\aws.cmd"` (not on PATH).

## REMAINING WORK
### Claude Code (critical path — the UI cannot go live without these)
1. **API routes** per `ApiRoutes` in `types/api.ts`, thin wrappers over `lib/*`: cases (list/create/detail/progress/milestones), documents (list, multipart upload ≤ 4 MiB, detail, content, verify, restore), FIR check + register verify, audit (list + chain verify), integrity scans (sync, ≤ 50 docs), requests + judge decision, assemble case folder (+ZIP bundle), `GET /api/chain`, `GET /api/chain/transactions`, `GET /api/batches`. Advocate downloads are watermarked (text: stamp; PDF/images: header + filename, say so honestly). `/api/verify/[docId]` and `/api/assistant` stay 503 FEATURE_DISABLED (bonus, cut).
2. Demo-attack route (`POST /api/demo/attack`, only when `SAKSHYA_DEMO_ATTACK=1`, ADMIN only) → `lib/demo-attack.ts`.
3. **Batch anchoring**: group documents into a Merkle batch (`merkle_batches`), `chain.anchorBatch`, fill `documents.merkle_proof/batch_id` via `withAnchor`.
4. Update `lib/evidence.ts` verify to use the on-chain batch root (`ChainReader`).
5. Deploy (`06-deploy.ps1 -Migrate`), then **import the 40 cases on the server** with the chain disabled (bundle `scripts/import-cases.mts` with esbuild; data via the private deploy bucket), end-to-end test of the 5 demo scenes on the live URL.
6. Refresh the architecture PDF; README; final commit. Optional: teardown script.
### Codex (UI)
1. Redesign brief (pure black `#000`, no blue/indigo/gradients, IBM Plex, saffron accent, dense tables, 4-authority login page, 40-row scale) — see the brief in the chat history / `docs/REQUESTS.md`.
2. FIR-number changes (no typing, show assigned number + check box + "Verify FIR register").
3. "Live blockchain activity" panel (`ChainTx`, Etherscan links) on dashboard + document page.
4. When routes land: set `NEXT_PUBLIC_USE_MOCKS=false`, wire pages to the live API, fix shape mismatches.
### Teammates / user
- 40 fictional case files: `data/cases-A` (C01–C20) and `data/cases-B` (C21–C40), format in `docs/DATA_IMPORT.md`; merge with `npm run merge:data`; validate `npm run import:cases -- data/cases --check`.
- Rehearsals ≈ 09:00 and 11:00 Sat. At the very end: delete IAM user `sakshya-deployer`, run teardown.

## Commands
`npm run dev` (human runs it) · `npm run typecheck` · `npm run lint` · `npm run test:unit` · `npm run test:aws` (needs `SAKSHYA_AWS_TESTS=1`, real AWS) · `npm run chain:e2e` · `npm run import:cases -- <dir> [--check]` · `npm run init:env` (creates `.env.local` secrets) · `cd contracts && npm run deploy:sepolia` / `preflight:sepolia`.

## Gotchas learned (don't repeat)
- PowerShell: quote CLI args containing commas; call quoted paths with `&`; Windows PowerShell 5.1 writes a BOM with `Set-Content -Encoding utf8` (use `[IO.File]::WriteAllText` with `UTF8Encoding($false)` for JSON).
- Python `str.replace` with `$$` in SQL collapses it to `$` — edit SQL with the Edit tool.
- Root package is CommonJS: scripts with top-level `await` must be `.mts`.
- PGlite allows ONE process per data dir — stop the dev server before running local scripts that use `.data/db`.
- Next 16: `cacheComponents` is OFF (needed for `runtime = "nodejs"`); params/cookies are async.
- RLS filters silently (0 rows, no error) — always treat "nothing returned" as not-found/denied (`requireRows`).
- Use Windows' `tar.exe` (Git Bash tar mis-parses `D:\`); AWS CLI prints `None` for empty results.
- Sepolia: ~12 s blocks; chain queue waits for each confirmation (dependent txs fail gas estimation otherwise). Sepolia gas is ~free; deploy cost 0.013 ETH; deployer `0x49e6…a8a0` has ~0.007 ETH (testnet only).
- Never commit or print: `.env.local`, `contracts/.env`, AWS credentials. A secret scan was clean at the last commit.
