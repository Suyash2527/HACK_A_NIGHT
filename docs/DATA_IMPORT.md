# Case data import (40 fictional cases)

Two people build the files **in separate folders** so nothing collides:

| Person | Cases | Folder | Manifest |
|---|---|---|---|
| A | C01–C20 | `data/cases-A/` | `data/cases-A/manifest.csv` |
| B | C21–C40 | `data/cases-B/` | `data/cases-B/manifest.csv` |

Claude merges them: `npm run merge:data` → `data/cases/` (fails loudly on any duplicate case or mismatched header), then validates with `npm run import:cases -- data/cases --check` and loads with `npm run import:cases -- data/cases`.

## manifest.csv — one row per document
`case_ref,station_code,stage,complainant_email,doc_type,file`

| Column | Rules |
|---|---|
| `case_ref` | `C01`…`C40`, unique per case, repeated on every row of the case |
| `station_code` | `GNG` (Gangapur), `PCV` (Panchavati) or `NSR` (Nashik Road) — same on every row of a case |
| `stage` | `FIR_REGISTERED`, `INVESTIGATION`, `FORENSIC_ANALYSIS`, `CHARGE_SHEET_FILED`, `TRIAL`, `JUDGMENT`, `CLOSED` — same on every row of a case |
| `complainant_email` | blank, or `complainant@sakshya.demo` (use for at most 2 cases) |
| `doc_type` | `FIR`, `WITNESS_STATEMENT`, `FORENSIC_REPORT`, `CHARGE_SHEET` |
| `file` | path relative to the folder, e.g. `C01/FIR.pdf` (`.pdf .txt .png .jpg .docx`, each ≤ 4 MB) |

## Rules the importer enforces
- Every case has a **FIR**. Stage `CHARGE_SHEET_FILED` or later needs a **CHARGE_SHEET**.
- The **FIR number is assigned by the system** (`GNG/2026/0007/A3F9`) — never write one inside a document.
- Each document is uploaded by the role that may upload it: police → FIR/witness, forensic lab → report, prosecutor → charge sheet.
- Everything is fictional. No real names, phone numbers, Aadhaar/PAN numbers, addresses or case facts.
