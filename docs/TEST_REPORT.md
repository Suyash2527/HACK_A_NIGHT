# Sakshya: test report (backend)

Run on Sat 10 Oct 2026 between 00:00 and 02:00 IST by Claude Code. Everything in this report was observed in a run. Nothing is estimated.

## 1. Automated tests (`npm run test:unit`)
**134 tests, 134 passed, 0 failed.** They run in-process with a real PostgreSQL engine (embedded PGlite) that has the production roles and forced row-level security.

| Area | File | What is proved |
|---|---|---|
| Crypto, Merkle, storage | `tests/crypto-merkle-storage.test.ts` | ML-KEM/ML-DSA/AES-GCM round trips, 64 KiB part sealing, tamper localisation by byte range |
| Database security | `tests/db-rls.test.ts`, `lib-db.test.ts` | Row-level security per role, append-only triggers, hash-chained audit and FIR register |
| Evidence service | `tests/evidence.test.ts` | Upload, six-check verification, withheld content, restore as a new version |
| Auth | `tests/auth.test.ts` | Signed sessions, forged/expired tokens rejected, 401 envelope |
| Core API | `tests/api-core.test.ts` | Cases, FIR assignment/check, FIR written in the browser, milestones, documents, content headers, tamper and restore, chain feed |
| Audit, scans, anchoring | `tests/api-audit-scan-anchor.test.ts` | Court-only audit explorer, a rewritten audit entry is detected, scans localise tampering, Merkle batch anchored, on-chain root mismatch reported TAMPERED, failed anchor retried |
| Court workflow | `tests/api-court.test.ts` | Advocate catalog (titles only), request validation, judge decision, watermarked access, expiry, assembly, ZIP bundle, superseded versions |
| Demo attack | `tests/api-demo.test.ts` | Route is a 404 unless `SAKSHYA_DEMO_ATTACK=1`; ADMIN only; the attack is detected at chunk 2 |
| Smart contract | `contracts/` (Hardhat) | 33 tests, run earlier by the contract owner |

## 2. Live end-to-end run (`scripts/e2e-live.mts`) on https://3-109-114-12.sslip.io
Real Cognito logins for 7 roles and real Sepolia transactions. **All checks passed** (final run, 00:20 IST).
- A FIR was registered with a system-assigned number (`GNG/2026/0002/FA55`). A genuine number checked as genuine and a forged one was rejected.
- A 16 KiB FIR was uploaded. It reached **VERIFIED** with all six checks passing. The anchor link pointed to Sepolia Etherscan, and the chain feed showed REGISTER_RECORD and ATTEST_SIGNATURE confirmed.
- Zero trust: the lab got 404 on an unassigned case and its content. The advocate and complainant saw no documents. The denial appeared in the audit log with its legal basis. Police were refused the audit explorer.
- Insider attack (valid re-encryption, one byte flipped): the scan found the document TAMPERED, localised to **chunk 2, bytes 8192–12287**. Authenticated decryption still passed. The retained original was available and the content was withheld with HTTP 409. A judge could not restore. Police restored version 2, which was byte-identical to the original and then reached VERIFIED. Version 1 stayed red.
- Audit chain verified (58 entries, head anchored) and the FIR register verified.
- Case folder: the report listed the historic tamper and offered a bundle that downloaded as a ZIP.

## 3. Live data smoke test (`scripts/smoke-live.mts`) at 01:30 IST
**All checks passed.**
- 42 cases and 152 documents (40 imported cases with 148 documents, plus 2 rehearsal cases with 4 documents).
- Cases per login: police 16 / 13 / 13, lab 40, prosecutor 40, court 42, advocate 0, complainant 3.
- A confirmed Merkle batch covers 117 imported documents.
- Complainant progress timeline shown with no documents.
- Advocate flow: catalog lookup, request filed, no access before the order, judge grant, document opened, download carried the watermark header, documents outside the order stayed hidden.
- Folder: all 5 documents VERIFIED on-chain, bundle downloaded as a ZIP, the advocate's folder held only granted documents.
- The audit chain, FIR register and a case scan were clean.

## 4. Defects found by testing, and their fixes
| Defect | Found by | Fix |
|---|---|---|
| The embedded database reported 0 rows for SELECT, so an assignment check was wrong | `api-core` test | Fixed in `lib/db.ts` |
| The live database had no `chain_txs` table, so anchoring failed and left a stuck batch | First live run | Idempotent patch `db/patches/001`; anchoring now skips a batch already on-chain |
| The server import bundle crashed on `require` | First import attempt | Added a require shim to the bundle step; re-run succeeded |
| A tampered superseded version blocked bundles forever | Test design | The bundle now holds current versions only; history is still reported |

## 5. Not tested or not built
- The UI pages were not tested by me (the UI belongs to Codex).
- The Bedrock assistant, public verify receipts and PDF watermarking are not built. The two routes return 503 `FEATURE_DISABLED`.
- Writing a FIR in the browser is covered by a unit test, but I have not run it on the live site.
- No load or performance testing was done.
