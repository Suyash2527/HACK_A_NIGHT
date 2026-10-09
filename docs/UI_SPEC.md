# Sakshya UI specification — final register design

Source of truth: docs/UI_REVAMP_BRIEF.md. Contract: types/api.ts. This document describes the implemented live UI; older black-theme and offline plans are superseded.

## Visual system

- Page #FAF8F4; panels #FFFFFF; text #1C1B19; secondary #5D5A52; borders #D9D4C7.
- One accent, saffron #C2410C, for links, current navigation and focus. Primary action is ink with white text. Secondary actions are outlined or links.
- VERIFIED alone uses green #15803D. TAMPERED and denied use red #B91C1C. Pending uses amber #B45309. Unchecked and operational success use neutral text. Every state has a label.
- IBM Plex Sans for UI and headings; IBM Plex Mono for FIR numbers, dates and hashes. Desktop headings 28px; section headings 20px; body 14px; tables 13px.
- Ruled sections and tables; white boxed integrity result where a distinct result matters. Four-pixel radii, no shadows, gradients, blur or decorative icon circles.
- Controls have 44px targets. Passive table rows are 36px, sortable header stays visible, pagination is 20 records. No zebra stripes.
- Dialogs dim the page, trap focus and return focus through Radix primitives. Motion is a 120ms fade; six checks reveal sequentially. Reduced-motion users receive no animations.

## Navigation and role homes

The shell reads Session.user.role. A thin top bar names the user, role and station; the sidebar shows permitted plain-text links. Mobile navigation uses a modal drawer. Login redirects an authenticated session to its role home.

| Role | Home | Primary action |
|---|---|---|
| POLICE | Station cases | Register FIR |
| FORENSIC_LAB | Assigned cases and explicit case selector | Upload forensic report |
| PUBLIC_PROSECUTOR | Assigned cases and explicit case selector | Upload charge sheet; assembly is secondary |
| JUDGE | Cases and pending request count | Decide requests |
| ADMIN | Counts, audit and blockchain activity | Verify audit chain |
| DEFENCE_ADVOCATE | Own requests and granted document links | Request documents |
| COMPLAINANT | Own case milestones only | Read current progress |

The backend remains authoritative for permissions. Disabled or hidden UI controls do not replace access checks. The complainant shell does not render document/hash sections or the technical trust footer.

## Core forms

Register FIR collects optional complainant email, place, occurrence date/time in IST, brief facts and the officer's written FIR. It sends CreateCaseRequest with firText and optional complainantEmail. The server assigns the number and station. The receipt shows a large mono number with a copy control. The UI never creates or edits the number.

Uploads use the contract's multipart fields and four-MiB limit. Lab and prosecutor uploads are restricted to their assigned document type. Corrections create new versions; there is no edit/delete evidence UI.

Advocates look up an FIR through the request catalog, select titles, and supply a citation and reason. The catalog intentionally provides no hashes or integrity state. Judges supply an Order ref. and note for Grant or Reject, with a subset and optional expiry for grants. Granted records show the order banner and watermarked-download explanation.

## Integrity and evidence

The document page consumes VerifyResult. It preserves all six checks, exact zero-based chunk ranges, labelled storage parts, recent accessors, legal basis, version history and anchor explorer link. Restore original is shown only for TAMPERED with a retained original and enabled only for a permitted contributor. Recovery appends a version.

Content uses the inline content endpoint. A 409 response immediately withholds content and the prior clean certificate while verification refreshes. Download requires a permitted VERIFIED result. Bundle download uses bundle.downloadPath exactly as supplied, including its user-bound token.

Live blockchain activity polls every ten seconds while visible. Confirmed transactions use a neutral badge, never a green document-verification claim. A null explorer URL is labelled Local dev chain.

ML-DSA signatures are verified off-chain by the backend. The chain stores hashes and the verifier's attestation, not a post-quantum signature verification operation.

## Data and errors

All UI data uses the shared typed api() helper. There are no offline datasets or simulated API branches. The helper throws the server envelope's message. Loading uses skeleton rows; empty states give a next step. Search and filters operate over fetched permitted pages with opaque cursors preserved.

The .env files are outside UI ownership. The removed flag cannot enable simulation; deployment should document NEXT_PUBLIC_USE_MOCKS=false or remove the obsolete setting.

## Acceptance

Run the 13 component regressions, npm run typecheck, npm run lint and npm run build. Complete docs/DEMO_SCRIPT.md's seven-role live browser checklist at 360px and 1280px. Code checks do not substitute for screenshots or an interactive rehearsal.
