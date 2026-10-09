"""Generates 40 clearly FICTIONAL case folders in the Sakshya import format (data/cases-G + manifest.csv).
Deterministic (seeded) so it can be re-run. Pure standard library: PDFs are written by a tiny PDF writer (ASCII text pages).
Usage:  python scripts/gen-sample-cases.py            -> data/cases-G/
Nothing here refers to real people, numbers, addresses or real case facts. Case refs are G01..G40 (teammates use C01..C40)."""
import os, random, textwrap, datetime

OUT = os.path.join("data", "cases-G")
rnd = random.Random(20261010)

STATIONS = {
    "GNG": ("Gangapur Police Station", "Gangapur Road", ["Someshwar Colony", "Anandvalli", "Gangapur Gaon", "Savarkar Nagar", "Ashok Nagar"]),
    "PCV": ("Panchavati Police Station", "Panchavati", ["Panchavati Karanja", "Ramkund Road", "Tapovan", "Mhasrul", "Peth Road"]),
    "NSR": ("Nashik Road Police Station", "Nashik Road", ["Deolali Gaon", "Jail Road", "Upnagar", "Bytco Point", "Datta Mandir Road"]),
}
FIRST = ["Aarav", "Meera", "Sanjay", "Pooja", "Rohit", "Sunita", "Vikas", "Anjali", "Prakash", "Kavita", "Nitin", "Sneha", "Ganesh", "Rekha", "Amol", "Swati",
         "Yogesh", "Madhuri", "Dinesh", "Asha", "Kunal", "Priya", "Rajesh", "Manisha", "Tushar", "Deepa", "Sachin", "Lata", "Harish", "Neeta"]
LAST = ["Pawar", "Jadhav", "Kulkarni", "Deshmukh", "Shinde", "More", "Gaikwad", "Bhosale", "Patil", "Joshi", "Chavan", "Kale", "Salunke", "Thorat", "Wagh", "Ahire", "Sonawane", "Borse"]
OFFICERS = {"GNG": "Inspector Aditi Patil", "PCV": "Inspector Vikram Shinde", "NSR": "Inspector Rahul Jadhav"}
EXPERT = "Dr. Neha Kulkarni, Scientific Officer, Nashik Forensic Science Laboratory"
PROSECUTOR = "Adv. Rohan Deshmukh, Public Prosecutor, District Court, Nashik"

# offence, title, forensic discipline, exhibit nouns, what the lab found
OFFENCES = [
    ("house-breaking and theft", "burglary at a residence", "Fingerprint and tool-mark examination", ["iron crowbar", "broken door latch", "lifted latent prints"], "three latent prints matched to the accused; tool marks consistent with the crowbar"),
    ("cheating by online fraud", "cyber fraud through a fake payment link", "Digital forensics: mobile and server logs", ["complainant's mobile phone", "SMS and browser history", "payment gateway log extract"], "the fraudulent link was opened from the complainant's phone; the payment trail leads to a mule account"),
    ("theft of a motorcycle", "two-wheeler theft from a parking area", "CCTV analysis and vehicle examination", ["parking CCTV footage", "ignition assembly", "chassis number plate"], "footage shows two persons removing the vehicle; chassis number had been filed down and restored"),
    ("voluntarily causing hurt", "assault during a property dispute", "Medical-legal and physical evidence examination", ["blood-stained clothing", "wooden stick", "injury certificate"], "blood group on the stick matches the injured person; injuries consistent with a blunt object"),
    ("forgery of documents", "forged sale agreement", "Questioned document examination", ["sale agreement", "specimen signatures", "stamp paper"], "signature on the agreement does not match specimen signatures; stamp paper purchase date is later than the agreement date"),
    ("rash driving causing death", "fatal road accident", "Vehicle mechanical inspection and scene reconstruction", ["truck brake assembly", "skid-mark photographs", "speed data extract"], "brakes were functional; skid marks indicate speed well above the limit"),
    ("extortion by threat", "extortion through threatening phone calls", "Digital forensics: call-detail and audio analysis", ["call-detail records", "audio recordings", "SIM card"], "voice samples show a high probability of the same speaker; the calls originated from the accused's SIM"),
    ("snatching of a gold chain", "chain snatching near a temple", "CCTV analysis and recovered-article examination", ["street CCTV footage", "recovered gold chain", "motorcycle"], "recovered chain identified by the complainant's jeweller's mark; footage shows the motorcycle used"),
    ("criminal breach of trust", "misappropriation by an accountant", "Forensic accounting", ["ledger books", "bank statements", "accounting software export"], "entries totalling a substantial sum were altered after the audit date; diverted amounts credited to a relative's account"),
    ("cheating through a chit fund", "fraudulent investment scheme", "Document and financial record examination", ["receipt books", "promotional pamphlets", "bank records"], "receipts carry duplicate serial numbers; collected amounts exceed declared deposits"),
    ("mischief by fire", "fire at a godown", "Fire and chemical analysis", ["burnt debris", "accelerant sample", "electrical meter"], "traces of a petroleum accelerant found at two points of origin; electrical short-circuit ruled out"),
    ("hurt by a dangerous weapon", "affray outside a hotel", "Weapon and ballistic-type examination", ["knife", "blood-stained shirt", "CCTV footage"], "blood on the knife matches the injured person; knife dimensions consistent with the wound"),
]
STAGES = ["INVESTIGATION"] * 8 + ["FORENSIC_ANALYSIS"] * 8 + ["CHARGE_SHEET_FILED"] * 8 + ["TRIAL"] * 8 + ["JUDGMENT"] * 4 + ["CLOSED"] * 4
IDX = {s: i for i, s in enumerate(["FIR_REGISTERED", "INVESTIGATION", "FORENSIC_ANALYSIS", "CHARGE_SHEET_FILED", "TRIAL", "JUDGMENT", "CLOSED"])}

# ---------------------------------------------------------------- minimal PDF writer (Helvetica, ASCII)
def _esc(s):
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

def make_pdf(title, lines, per_page=52):
    pages = [lines[i:i + per_page] for i in range(0, len(lines), per_page)] or [[""]]
    objs = []
    def add(b): objs.append(b); return len(objs)
    cat = add(b""); pgs = add(b""); font = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>")
    kids = []
    for n, pl in enumerate(pages, 1):
        content = ["BT", "/F1 9 Tf", "13 TL", "50 800 Td", f"({_esc(title)}  -  page {n} of {len(pages)}) Tj", "T*", "T*"]
        for ln in pl: content += [f"({_esc(ln)}) Tj", "T*"]
        content.append("ET")
        stream = "\n".join(content).encode("latin-1", "replace")
        c = add(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
        p = add(f"<< /Type /Page /Parent {pgs} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 {font} 0 R >> >> /Contents {c} 0 R >>".encode())
        kids.append(p)
    objs[cat - 1] = f"<< /Type /Catalog /Pages {pgs} 0 R >>".encode()
    objs[pgs - 1] = (f"<< /Type /Pages /Count {len(kids)} /Kids [" + " ".join(f"{k} 0 R" for k in kids) + "] >>").encode()
    out = bytearray(b"%PDF-1.4\n"); offs = []
    for i, o in enumerate(objs, 1):
        offs.append(len(out)); out += f"{i} 0 obj\n".encode() + o + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for o in offs: out += f"{o:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root {cat} 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)

def wrap(text, width=84):
    out = []
    for para in text.split("\n"):
        out += textwrap.wrap(para, width) or [""]
    return out

def person():
    return f"{rnd.choice(FIRST)} {rnd.choice(LAST)}"

def date(m, d): return datetime.date(2026, m, d).strftime("%d %B %Y")

# ---------------------------------------------------------------- one case
def build_case(n):
    ref = f"G{n:02d}"
    code = ["GNG", "PCV", "NSR"][(n - 1) % 3]
    stage = STAGES[n - 1]
    st_name, area, localities = STATIONS[code]
    off = OFFENCES[(n - 1) % len(OFFENCES)]
    offence, title, discipline, exhibits, finding = off
    complainant, accused, w1, w2 = person(), person(), person(), person()
    place = rnd.choice(localities)
    m = rnd.randint(1, 8); d = rnd.randint(2, 26)
    inc, rep, lab, chg = date(m, d), date(m, d + 1), date(m + 1, min(d + 4, 27)), date(min(m + 2, 9), min(d + 8, 27))
    officer = OFFICERS[code]
    folder = os.path.join(OUT, ref); os.makedirs(folder, exist_ok=True)
    files = []

    def put(name, doc_type, pdf_title, body_lines):
        path = os.path.join(folder, name)
        with open(path, "wb") as f:
            f.write(make_pdf(pdf_title, body_lines) if name.endswith(".pdf") else "\n".join(body_lines).encode("ascii", "replace"))
        files.append((doc_type, f"{ref}/{name}"))

    # FIR
    put("FIR.pdf", "FIR", f"First Information Report - {st_name}", [
        "FIRST INFORMATION REPORT", f"Police Station: {st_name}", "FIR No.: (assigned by the system on registration)", f"Date and time of report: {rep}, 11:40 hrs",
        f"Date and place of occurrence: {inc}, near {place}, {area}, Nashik", f"Offence: {offence}", "",
        "Complainant", f"  Name: {complainant}", f"  Resident of: {place}, Nashik (fictional address)", "",
        "Information given by the complainant:", *wrap(
            f"On {inc} the complainant came to the police station and stated that a {title} had taken place near {place}. "
            f"The complainant suspects {accused}, who was seen in the vicinity earlier that day. The complainant lost articles of value and "
            f"requests that action be taken. Two persons, {w1} and {w2}, are named as having witnessed part of the incident.", 84), "",
        "Action taken:", *wrap(f"The report was registered and entrusted to {officer} for investigation. The scene is to be inspected and "
                              f"exhibits collected. The complainant was informed of the right to receive a copy of this report.", 84), "",
        "This is a fictional document created for a software demonstration.", f"Reported to: {officer}"])

    # witness statements
    for i, w in enumerate([w1, w2][: (1 if n % 2 else 2)], 1):
        put(f"Witness_{i}.pdf", "WITNESS_STATEMENT", f"Statement of {w}", [
            "STATEMENT OF WITNESS", f"Recorded at: {st_name}", f"Date: {date(m, d + 2)}", f"Witness: {w}", "",
            *wrap(f"I live near {place}. On {inc} I was present when I noticed {accused} close to the place of occurrence. "
                  f"{'I saw the accused leave in a hurry.' if i == 1 else 'I confirm what the first witness has stated and I identified the articles shown to me.'} "
                  f"I am willing to give evidence before the court if required.", 84), "",
            "Recorded by: " + officer, "Fictional statement for demonstration purposes."])
    docs = [("FIR", files[0][1])] + [(t, p) for t, p in files[1:]]

    # forensic report + charge sheet when stage is beyond analysis
    if IDX[stage] >= IDX["CHARGE_SHEET_FILED"]:
        big = n % 5 == 0   # 8 cases get a long report -> stored as several 64 KiB parts
        body = [
            "FORENSIC EXAMINATION REPORT", f"Laboratory: Nashik Forensic Science Laboratory (fictional)", f"Discipline: {discipline}", f"Date of report: {lab}", f"Related police station: {st_name}", "",
            "1. EXHIBITS RECEIVED", *[f"   Exhibit {chr(65 + k)}: {e}" for k, e in enumerate(exhibits)], "",
            "2. METHOD", *wrap("Exhibits were examined under controlled conditions, photographed, hashed where digital, and compared against reference material "
                              "using standard laboratory procedures. Chain-of-custody forms accompanied each exhibit.", 84), "",
            "3. FINDINGS", *wrap(f"The examination found that {finding}.", 84), "",
            "4. OPINION", *wrap("The findings support the prosecution's account but do not by themselves establish who committed the offence. "
                               "The opinion is limited to the material received.", 84), "", f"Examined by: {EXPERT}"]
        if big:
            body += ["", "5. ANNEXURE - EXHIBIT HANDLING LOG (full)"]
            for k in range(1, 1200):
                body.append(f"   {k:04d}  {date(m + 1, min(d + 4, 27))}  Exhibit {chr(65 + k % len(exhibits))}  handled by technician T-{rnd.randint(11, 59)}  seal intact  entry verified")
        put("Forensic_Report.pdf", "FORENSIC_REPORT", f"Forensic Report - {ref}", body)
        docs.append(("FORENSIC_REPORT", f"{ref}/Forensic_Report.pdf"))
        put("Charge_Sheet.pdf", "CHARGE_SHEET", f"Charge Sheet - {ref}", [
            "CHARGE SHEET (FINAL REPORT)", f"Police Station: {st_name}", "FIR No.: (assigned by the system on registration)", f"Date: {chg}", "",
            f"Accused: {accused} (fictional)", f"Offence: {offence}", "",
            *wrap(f"The investigation by {officer} is complete. The statements of {w1}" + (f" and {w2}" if n % 2 == 0 else "") +
                  " and the forensic report support the allegation. The accused is sent up for trial.", 84), "",
            "List of documents relied upon: First Information Report, witness statement(s), forensic examination report.",
            f"Submitted by: {officer}", f"Reviewed by: {PROSECUTOR}", "Fictional document for demonstration."])
        docs.append(("CHARGE_SHEET", f"{ref}/Charge_Sheet.pdf"))
    return ref, code, stage, docs

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    rows = ["case_ref,station_code,stage,complainant_email,doc_type,file"]
    for n in range(1, 41):
        ref, code, stage, docs = build_case(n)
        comp = "complainant@sakshya.demo" if n == 5 else ""
        rows += [f"{ref},{code},{stage},{comp},{t},{p}" for t, p in docs]
    with open(os.path.join(OUT, "manifest.csv"), "w", newline="\n") as f:
        f.write("\n".join(rows) + "\n")
    total = sum(os.path.getsize(os.path.join(r, fn)) for r, _, fs in os.walk(OUT) for fn in fs)
    print(f"generated 40 cases, {len(rows) - 1} documents, {total / 1024:.0f} KB in {OUT}")
