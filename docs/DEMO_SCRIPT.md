# Sakshya — court-register UI demo path

Use the deployed HTTPS site or the single local server on port 3100. Live mode is NEXT_PUBLIC_USE_MOCKS=false. Offline mode is explicitly true and shows “Demo data — simulated results”. The shared password is entered by the operator; never put it in this document or a screenshot.

## Preparation

- Retain one dev process only; the embedded database permits one process per data directory. Do not run scripts that open .data/db while the server runs.
- Prepare Police, Forensic, Judge, Prosecutor and Admin browser sessions. Use the four authority choices on Sign in; Court includes Judge and Public Prosecutor. Advocate and Complainant use the smaller links.
- Create the case through Register case. Enter only the optional complainant email. Copy the assigned FIR No.; station, serial and code come from the system.
- Have a 16,384-byte fictional FIR text file, an assigned forensic report, an unassigned case URL and a previously anchored document ready.
- Verify the prepared document shows VERIFIED and the six checks pass. Allow time for new uploads to anchor. A confirmed transaction alone does not mean the document is VERIFIED.
- Rehearse with backend's approved demo attack tool and retained original. For localisation, the attack must modify plaintext then re-encrypt with a valid tag; a raw ciphertext flip can fail decryption without a chunk range.
- Check the live transaction table has real explorer links. No explorer URL is labelled Local dev chain.

## Three-minute run

| Time | Operator | Screen and explanation |
|---|---|---|
| 0:00–0:30 | Police: My cases → Register case → copy assigned FIR No. → open case → Upload document → FIR → choose file → Review upload → Encrypt and upload | Show the assigned code tag, upload receipt, AES-256-GCM, ML-KEM-768, ML-DSA-65 and audit reference. Keep UNANCHORED or PENDING_ANCHOR labels visible. |
| 0:30–0:55 | Forensic: open unassigned case link; then assigned case → Upload document → Forensic report | Show access denied, then permitted upload. Judge/Admin can inspect the DENIED audit event and its legal basis. |
| 0:55–1:20 | Judge/Admin: Home → Live blockchain activity; Prosecutor: prepared document → Verify now | Watch submitted/confirmed transactions, block number and Etherscan receipt. Show six checks and VERIFIED on the prepared document. ML-DSA is verified off-chain by our backend; the chain stores hashes and the verifier's attestation. |
| 1:20–1:50 | Human runs approved attack tool; Admin: Integrity → Run integrity scan → affected document | Show red TAMPERED, chunk 2, bytes 8192–12287, the failed checks and storage part. Content is withheld. Recent accessors are context, not proof of responsibility. |
| 1:50–2:20 | Police: damaged document → Restore original → enter reason → Confirm recovery → Open recovered version | Restore appends a new version. The damaged version and audit history remain. Keep amber until the backend returns VERIFIED; refresh after anchoring. |
| 2:20–2:45 | Advocate: Document requests → File request → FIR No. → Find case → tick titles → citation and reason → File request. Judge: Requests queue → Review request → order reference and note → Confirm grant | Access requires the court decision. Advocate opens the granted document and sees the court-order banner, expiry and watermarked download notice. |
| 2:45–3:00 | Complainant: My case progress; Admin: Audit chain → Verify audit chain / Verify FIR register | Show public-safe milestones, then immutable event/legal-basis records and register checks. Finish on the trust copy. |

## Validation and fallback

- Check Login, Home, Cases, Case detail, Document, Integrity, Requests, Audit, Batches and Progress at 1280px and 375px. Capture Login, Cases and Document before/after.
- With 40 cases, search FIR/station, combine Stage/Station/Integrity filters, sort each column, then move between two 20-row pages. Clear filters and confirm page resets.
- A pending anchor stays amber. Chain failure stays visible. Do not call a recovery verified until status is VERIFIED.
- If live services fail, switch explicitly to the offline build, state that the results are simulated, and retain the demo banner. Never fabricate an explorer transaction.
- Assistant and public verification are deferred; keep the unavailable screens. Spend demo time on working case, integrity and custody flows.

## Verification status for this redesign

Typecheck, lint and a production build are required before delivery. Browser visual review and live UI rehearsal must be completed using a connected browser. The editing session currently has no browser connection; responsive checks and before/after screenshots remain pending.

Final look: warm off-white page, white result panels, ink buttons, saffron links, serif page titles and ruled tables. Restore is absent on clean versions. Dialogs dim the page and retain modal keyboard focus. Signed-in visitors return from Login to their role home. Final browser review is requested from the operator; the pre-restyle live flows were verified by the operator.
