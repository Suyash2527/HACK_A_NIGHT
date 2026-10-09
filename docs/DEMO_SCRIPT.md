# Sakshya — final court-register demo

## Before presenting

Use https://3-109-114-12.sslip.io after the final UI deployment. The UI is live-only; there is no simulated fallback. Enter the shared demo password privately. Never include it in screenshots or this document.

Prepare seven role sessions through the four authority choices. Court includes Judge and Public Prosecutor; the smaller links select Defence Advocate and Complainant. Use fictional complaint text and exhibits only. Keep a verified, anchored document and a rehearsed tampered document ready. The operator runs any approved tamper rehearsal; the UI never alters evidence in place.

Do not start a second local server: the embedded database allows one process. Use the deployed database for the live rehearsal.

## Role checklist

| Role | Home and primary action | Evidence to check |
|---|---|---|
| Police | Station cases → Register FIR | Enter optional complainant email, place, occurrence date/time (IST), brief facts and written FIR. Submit once. The server assigns the FIR No. and stores FIR.txt. Copy the number and open the case. No editable number or station input. |
| Forensic laboratory | Assigned cases → select FIR → Upload forensic report | Only FORENSIC_REPORT is offered. Select a permitted file of at most 4,194,304 bytes. Review and upload; keep its returned integrity status visible. |
| Public prosecutor | Assigned cases → select FIR → Upload charge sheet | Only CHARGE_SHEET is offered. Assemble case folder is secondary. Download is available only when the returned report permits it. |
| Judge | All cases → Decide requests | Pending count is visible. Choose Grant or Reject, enter Order ref. and note. For grants, select a document subset and optional expiry. Review scans and case assembly as secondary actions. |
| Administration | Verify audit chain | Review the returned entry count and result. Open Audit chain / FIR register to verify the register; run an integrity scan and inspect batches. |
| Defence advocate | Document requests → Request documents | Enter an FIR No., find the case, select document titles, enter citation and reason. After a judge grants access, open a granted document and download its watermarked copy. |
| Complainant | Case progress | Show the plain-language current stage and dated updates. No evidence contents, document links or hashes. |

Imported rehearsal FIRs include PCV/2026/0011/E830 for requests and PCV/2026/0002/B085 for complainant progress. Confirm their current state before presenting; records may have changed during rehearsals.

## Three-minute presentation

1. **Police, 30 seconds:** Write and register a fictional FIR. Show the large assigned number and copy button. Open the case and the first FIR exhibit.
2. **Forensic / prosecutor, 25 seconds:** Select an assigned case and show the role-specific upload. The receipt may be UNANCHORED or PENDING_ANCHOR; do not call it verified yet.
3. **Judge, 30 seconds:** Open a prepared VERIFIED exhibit. Show all six checks, storage parts, recent accessors and the explorer receipt. Watch Live blockchain activity; confirmed transactions alone do not prove the exhibit is VERIFIED.
4. **Tamper / recovery, 45 seconds:** Open the rehearsed TAMPERED exhibit. Show “chunk 2 · bytes 8192–12287”, failed checks and withheld content. A permitted contributor selects Restore original and supplies a reason. Open the appended recovery version and verify it after anchoring. The incident remains in custody history.
5. **Advocate / judge, 35 seconds:** File a document request, record the judge's grant, then open the granted exhibit. Show Order ref., Granted till and the watermarked copy.
6. **Complainant / admin, 15 seconds:** Show the plain progress sentence, then the audit/register results.

Say: “ML-DSA is verified off-chain by our backend. The chain stores hashes and the verifier's attestation.” Accessor names provide context, not proof of responsibility.

## Final browser acceptance

At 1280px and 360px, check Sign in, all role homes, Cases, Case, Document, Progress, Requests, Audit, Integrity and Batches. Only tables may scroll horizontally. Capture Sign in, Cases and Document screenshots. Test keyboard focus in upload, grant and restore dialogs; Escape and close return focus to the trigger. A clean version must not show Restore original.

On Cases, search FIR/station, combine Stage / Station / Integrity filters, sort columns and navigate 20-row pages. The automated regression covers 40 generated table records; real 40-case visual review is still required.

If content returns HTTP 409, confirm the tamper warning replaces any earlier clean certificate and download is disabled. Check that assembly follows the server-provided download path without rebuilding its token. Sign in as all seven roles and complete the action in the checklist above.

## Verification record

The 13 UI regressions, typecheck, lint and build are run before delivery. Lint currently reports an existing unused import in unowned scripts/_l.mts; no UI warning is accepted. Browser tools in this editing session are unavailable, so final responsive screenshots and the seven-role live UI rehearsal must be completed by the operator or through a reconnected browser. Earlier live flows were verified by the operator before this revamp; that does not verify the new FIR form or new role homes.

Visual baseline: warm off-white page, white panels, ink buttons, saffron links, IBM Plex Sans UI, IBM Plex Mono identifiers, ruled tables and 4px corners. No dark theme or simulated results.
