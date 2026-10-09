# UI revamp brief: paste this to the UI agent (Codex)

You own `app/**` (except `app/api/**`), `components/**`, `app/globals.css` and `public/**`. Do not touch backend files. The API is complete and live; every shape is in `types/api.ts`. Freeze is at **04:30 Sat**, so ship in small commits (`ui:` prefix) and keep `npm run build` green.

## Goal
Judges award marks for the UI and will read the code. It must be **easy for every role to use**, and it must **not look AI-generated**. Think of a well-made government register or court e-filing tool, not a startup dashboard.

## Look
- White and warm off-white backgrounds (`#FFFFFF`, `#FAF8F4`), ink text (`#1C1B19`), one accent (saffron `#C2410C` or deep ink-blue `#1E3A5F`, pick one). Status colours only: green `#15803D` VERIFIED, red `#B91C1C` TAMPERED/denied, amber `#B45309` pending.
- No gradients, glow, glassmorphism, purple/indigo, emoji or sparkle icons, and no "AI" badges.
- Typography does the work. Use IBM Plex Sans for UI and IBM Plex Mono for hashes and FIR numbers. Use clear sizes: 28/20/16/14. Left-align everything.
- Use ruled tables and thin 1 px borders with small radii (4 px). Avoid big rounded cards, avoid a uniform grid of identical cards, and use few shadows.
- Plain, specific copy in Indian-court vocabulary: "Register FIR", "Case diary", "Seizure memo", "Order ref.", "Granted till". No "seamless", "powerful" or "unlock".

## Make it usable by every role (one home page per role, big obvious primary action)
| Role | Home shows | Primary action |
|---|---|---|
| POLICE | My station's cases (table: FIR no., stage, documents, integrity) | **Register FIR**: a form where the officer **writes the FIR text** in a large textarea (with simple fields above it: complainant email optional, place, date/time, brief facts). Submit `POST /api/cases {complainantEmail?, firText}`. The server assigns the FIR number, stores the text as the first FIR document (encrypted + signed) and returns `CaseDetail`. Show the assigned number big, with a copy button. |
| FORENSIC_LAB | Assigned cases | Upload forensic report (only `FORENSIC_REPORT`) |
| PUBLIC_PROSECUTOR | Assigned cases | Upload charge sheet · Assemble case folder |
| JUDGE | All cases + pending document requests count | Decide requests (Grant/Reject with order ref + note + optional expiry) · Run integrity scan · Assemble folder |
| ADMIN | Integrity + audit + batches | Verify audit chain · Verify FIR register · Run scan |
| DEFENCE_ADVOCATE | My requests + granted documents | **Request documents**: type an FIR number → `GET /api/requests/catalog?firNo=` → tick documents → citation + reason → `POST /api/requests` |
| COMPLAINANT | My case(s) | Progress timeline only (`GET /api/cases/[id]/progress`). Use large text and plain words such as "Your complaint is with the forensic laboratory". |

Everyone should get:
- One clear primary button per page, with secondary actions as plain links.
- Empty states that say what to do next.
- A visible error message from `error.message` in the API envelope. Never show "Unexpected error" alone.
- Keyboard and screen-reader friendly controls: labels on every input, focus rings, 44 px touch targets, and a page that works at 360 px width.
- Hindi/Marathi users: keep sentences short and avoid jargon; tooltips explain "hash", "anchor" and "ML-DSA" in one line.
- Integrity always visible: a coloured status pill on every document row. In the document page's IntegrityPanel, list the six checks with pass/fail, the tamper range (e.g. "chunk 2 · bytes 8192–12287"), the part grid, the last accessors and an Etherscan link (`anchor.explorerUrl`).

## Wire to the live API
Set `NEXT_PUBLIC_USE_MOCKS=false`, then delete `components/quantumshield/mocks.ts` and any mock branches. Upload is `POST /api/documents` (multipart: `file`, `caseId`, `type`, `parentId?`, ≤ 4 MiB). Content opens `GET /api/documents/[id]/content?disposition=inline` in a new tab; 409 means tampered, so show the red panel. The assembly bundle link is `bundle.downloadPath`, used as-is. Try it on https://3-109-114-12.sslip.io with the demo accounts.

## Code the judges will read
- Use small, named components with one job each. Delete unused shadcn components and dead files.
- Import types from `@/types/api` and never redefine them. Have one `api()` fetch helper that throws the envelope message.
- No `any` and no commented-out code. Write short comments only where the reason isn't obvious.
