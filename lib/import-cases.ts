// SERVER-ONLY bulk importer: loads case folders as REAL records — each document is encrypted in parts, signed (ML-DSA-65) by the
// right officer, audited and folded into the case manifest, exactly as if uploaded through the app. Nothing is inserted behind
// the application's back, so every imported case verifies, shows custody, and can be tampered with and restored in the demo.
//
// manifest.csv — one row per DOCUMENT (cases are grouped by case_ref):
//   case_ref,station_code,stage,complainant_email,doc_type,file
//   C01,GNG,TRIAL,complainant@sakshya.demo,FIR,C01/FIR.pdf
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CASE_STAGES, ROLE_UPLOAD_TYPES, type CaseStage, type DocType, type Role } from "@/types/api";
import { getDb } from "./db";
import { uploadDocument, type EvidenceDeps } from "./evidence";
import type { SessionUser } from "./session";

export const DOC_TYPES: DocType[] = ["FIR", "WITNESS_STATEMENT", "FORENSIC_REPORT", "CHARGE_SHEET"];
const MIME: Record<string, string> = { ".pdf": "application/pdf", ".txt": "text/plain", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };

export interface ManifestRow { case_ref: string; station_code: string; stage: CaseStage; complainant_email: string; doc_type: DocType; file: string; line: number }
export interface ImportPlanCase { ref: string; stationCode: string; stage: CaseStage; complainantEmail: string; docs: { type: DocType; file: string; line: number }[] }

/** RFC-4180-ish CSV parser: quoted fields, escaped quotes, CRLF, UTF-8 BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ""; let q = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && src[i + 1] === "\n") i++; row.push(field); if (row.some((f) => f.trim() !== "")) rows.push(row); row = []; field = ""; }
    else field += c;
  }
  row.push(field); if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

export interface PlanResult { cases: ImportPlanCase[]; errors: string[] }

/** Validates the whole manifest up front and reports EVERY problem with its line number (nothing is imported on error). */
export function planFromManifest(csv: string, fileExists: (rel: string) => boolean): PlanResult {
  const rows = parseCsv(csv); const errors: string[] = [];
  if (!rows.length) return { cases: [], errors: ["manifest is empty"] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  for (const need of ["case_ref", "station_code", "stage", "doc_type", "file"]) if (!header.includes(need)) errors.push(`missing column "${need}"`);
  if (errors.length) return { cases: [], errors };
  const col = (r: string[], n: string) => (r[header.indexOf(n)] ?? "").trim();
  const byCase = new Map<string, ImportPlanCase>(); const seenFiles = new Set<string>();
  rows.slice(1).forEach((r, i) => {
    const line = i + 2; const ref = col(r, "case_ref"); const stage = col(r, "stage").toUpperCase() as CaseStage;
    const type = col(r, "doc_type").toUpperCase() as DocType; const file = col(r, "file").replace(/\\/g, "/"); const station = col(r, "station_code").toUpperCase();
    if (!ref) errors.push(`line ${line}: case_ref is empty`);
    if (!/^[A-Z]{2,4}$/.test(station)) errors.push(`line ${line}: station_code "${station}" must be 2–4 capital letters (GNG, PCV, NSR)`);
    if (!CASE_STAGES.includes(stage)) errors.push(`line ${line}: stage "${stage}" must be one of ${CASE_STAGES.join(", ")}`);
    if (!DOC_TYPES.includes(type)) errors.push(`line ${line}: doc_type "${type}" must be one of ${DOC_TYPES.join(", ")}`);
    if (!MIME[path.extname(file).toLowerCase()]) errors.push(`line ${line}: file "${file}" has an unsupported extension (allowed: ${Object.keys(MIME).join(" ")})`);
    else if (file.includes("..")) errors.push(`line ${line}: file path may not contain ".."`);
    else if (!fileExists(file)) errors.push(`line ${line}: file not found: ${file}`);
    if (seenFiles.has(file)) errors.push(`line ${line}: file listed twice: ${file}`); seenFiles.add(file);
    let c = byCase.get(ref);
    if (!c) byCase.set(ref, (c = { ref, stationCode: station, stage, complainantEmail: col(r, "complainant_email").toLowerCase(), docs: [] }));
    else if (c.stationCode !== station || c.stage !== stage) errors.push(`line ${line}: case ${ref} has conflicting station_code/stage across its rows`);
    c.docs.push({ type, file, line });
  });
  for (const c of byCase.values()) {
    if (!c.docs.some((d) => d.type === "FIR")) errors.push(`case ${c.ref}: every case needs a FIR document`);
    if (CASE_STAGES.indexOf(c.stage) >= CASE_STAGES.indexOf("CHARGE_SHEET_FILED") && !c.docs.some((d) => d.type === "CHARGE_SHEET"))
      errors.push(`case ${c.ref}: stage ${c.stage} requires a CHARGE_SHEET document`);
    if (CASE_STAGES.indexOf(c.stage) >= CASE_STAGES.indexOf("FORENSIC_ANALYSIS") && !c.docs.some((d) => d.type === "FORENSIC_REPORT") && c.stage !== "CHARGE_SHEET_FILED" && c.stage !== "TRIAL" && c.stage !== "JUDGMENT" && c.stage !== "CLOSED")
      void 0; // forensic report is optional (not every case has one)
  }
  return { cases: [...byCase.values()], errors };
}

// ───────────────────────────── execution
export interface ImportReport { cases: number; documents: number; skipped: string[]; firNumbers: Record<string, string> }

const STAGE_NOTES: Partial<Record<CaseStage, string>> = {
  INVESTIGATION: "Investigation started; witnesses being examined", FORENSIC_ANALYSIS: "Exhibits sent to the forensic laboratory",
  CHARGE_SHEET_FILED: "Charge sheet filed before the court", TRIAL: "Trial listed; evidence being led", JUDGMENT: "Judgment reserved", CLOSED: "Case closed",
};

async function actors(): Promise<{ police: Map<string, SessionUser>; lab: SessionUser; prosecutor: SessionUser; judge: SessionUser; byEmail: Map<string, SessionUser> }> {
  const db = await getDb();
  const rows = await db.withAdmin(async (tx) => (await tx.query<SessionUser & { station_code: string | null }>("SELECT id, name, email, role, station, station_code, clearance FROM users")).rows);
  const police = new Map<string, SessionUser>(); const byEmail = new Map<string, SessionUser>();
  const one = (role: Role) => { const u = rows.find((r) => r.role === role); if (!u) throw new Error(`no ${role} user exists`); return u; };
  for (const r of rows) { byEmail.set(r.email.toLowerCase(), r); if (r.role === "POLICE" && r.station_code) police.set(r.station_code, r); }
  return { police, lab: one("FORENSIC_LAB"), prosecutor: one("PUBLIC_PROSECUTOR"), judge: one("JUDGE"), byEmail };
}

/** Imports a validated plan. Re-running is safe: a case_ref already imported (matched by a DB-side note) is skipped. */
export async function importPlan(plan: ImportPlanCase[], readFileBytes: (rel: string) => Promise<Buffer>, deps?: EvidenceDeps, log: (m: string) => void = () => {}): Promise<ImportReport> {
  const db = await getDb(); const a = await actors();
  const report: ImportReport = { cases: 0, documents: 0, skipped: [], firNumbers: {} };
  for (const c of plan) {
    const police = a.police.get(c.stationCode);
    if (!police) { report.skipped.push(`${c.ref}: no police user with station code ${c.stationCode}`); continue; }
    const complainant = c.complainantEmail ? a.byEmail.get(c.complainantEmail) : undefined;
    if (c.complainantEmail && complainant?.role !== "COMPLAINANT") { report.skipped.push(`${c.ref}: complainant ${c.complainantEmail} is not a COMPLAINANT user`); continue; }

    const created = await db.withUser(police.id, async (tx) => (await tx.query<{ case_id: string; fir_no: string }>("SELECT case_id, fir_no FROM create_case($1)", [complainant?.id ?? null])).rows[0]);
    await db.withUser(police.id, async (tx) => { await tx.query("SELECT assign_user($1,$2)", [created.case_id, a.lab.id]); await tx.query("SELECT assign_user($1,$2)", [created.case_id, a.prosecutor.id]); });
    report.firNumbers[c.ref] = created.fir_no;

    // documents: each uploaded by the role the matrix allows, FIR first so versions/manifests grow in a realistic order
    const order: DocType[] = ["FIR", "WITNESS_STATEMENT", "FORENSIC_REPORT", "CHARGE_SHEET"];
    for (const d of [...c.docs].sort((x, y) => order.indexOf(x.type) - order.indexOf(y.type))) {
      const actor = (Object.entries(ROLE_UPLOAD_TYPES).find(([, t]) => t.includes(d.type))![0] as Role) === "POLICE" ? police
        : d.type === "FORENSIC_REPORT" ? a.lab : a.prosecutor;
      const bytes = await readFileBytes(d.file);
      await uploadDocument(actor, { caseId: created.case_id, type: d.type, filename: path.basename(d.file), mimeType: MIME[path.extname(d.file).toLowerCase()], bytes }, deps);
      report.documents++;
    }
    // walk the case through its lifecycle up to the target stage (police early, court later — matching who really records them)
    for (const stage of CASE_STAGES.slice(1, CASE_STAGES.indexOf(c.stage) + 1)) {
      const by = CASE_STAGES.indexOf(stage) <= CASE_STAGES.indexOf("CHARGE_SHEET_FILED") ? police : a.judge;
      await db.withUser(by.id, (tx) => tx.query("SELECT add_milestone($1,$2::case_stage,$3)", [created.case_id, stage, STAGE_NOTES[stage] ?? null]));
    }
    report.cases++; log(`${c.ref} → ${created.fir_no} (${c.docs.length} docs, stage ${c.stage})`);
  }
  return report;
}

export async function importFromDirectory(dir: string, deps?: EvidenceDeps, log?: (m: string) => void): Promise<{ report?: ImportReport; errors: string[] }> {
  const fs = await import("node:fs");
  const csv = await readFile(path.join(dir, "manifest.csv"), "utf8");
  const { cases, errors } = planFromManifest(csv, (rel) => fs.existsSync(path.join(dir, rel)) && path.resolve(dir, rel).startsWith(path.resolve(dir)));
  if (errors.length) return { errors };
  const report = await importPlan(cases, (rel) => readFile(path.join(dir, rel)), deps, log);
  return { report, errors: [] };
}
