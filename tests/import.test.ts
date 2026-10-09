import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createPgliteDatabase, setDbForTests, type Database } from "../lib/db";
import { generateSeeds } from "../lib/crypto/pqc";
import { importFromDirectory, parseCsv, planFromManifest } from "../lib/import-cases";
import { getDocumentDetail, listCaseDocuments, verifyDocumentById } from "../lib/evidence";
import { ensureDemoUsers } from "../lib/seed";
import { LocalPartStore } from "../lib/storage/part-store";
import { demoUserByRole } from "../lib/demo-users";
import type { SessionUser } from "../lib/session";

let db: Database; let dir: string; let storeDir: string;
const HEADER = "case_ref,station_code,stage,complainant_email,doc_type,file";
const exists = (set: string[]) => (rel: string) => set.includes(rel);

describe("manifest validation", () => {
  it("parses quoted CSV, BOM and CRLF", () => {
    assert.deepEqual(parseCsv('﻿a,b\r\n"x,1","he said ""hi"""\r\n'), [["a", "b"], ["x,1", 'he said "hi"']]);
  });
  it("accepts a good manifest and groups rows into cases", () => {
    const csv = [HEADER, "C01,GNG,INVESTIGATION,,FIR,C01/FIR.pdf", "C01,GNG,INVESTIGATION,,WITNESS_STATEMENT,C01/W1.txt"].join("\n");
    const r = planFromManifest(csv, exists(["C01/FIR.pdf", "C01/W1.txt"]));
    assert.deepEqual(r.errors, []);
    assert.equal(r.cases.length, 1);
    assert.equal(r.cases[0].docs.length, 2);
  });
  it("reports every problem with its line number and imports nothing", () => {
    const csv = [HEADER,
      "C01,gng1,NOPE,,FIR,C01/FIR.pdf",
      "C02,GNG,TRIAL,,BOGUS,C02/x.exe",
      "C03,GNG,TRIAL,,FIR,C03/missing.pdf",
      "C03,GNG,TRIAL,,FIR,C03/missing.pdf",
      "C04,GNG,CLOSED,,FIR,../etc/passwd.txt"].join("\n");
    const { errors } = planFromManifest(csv, exists(["C01/FIR.pdf"]));
    const text = errors.join("\n");
    for (const needle of ["line 2", "station_code", "stage", "line 3", "doc_type", "unsupported extension", "file not found", "listed twice", "..", "requires a CHARGE_SHEET"])
      assert.ok(text.includes(needle), `expected an error mentioning "${needle}"\n${text}`);
  });
  it("requires the expected columns and a FIR per case", () => {
    assert.match(planFromManifest("case_ref,file\nC1,x", () => true).errors.join(), /missing column/);
    const noFir = planFromManifest([HEADER, "C01,GNG,INVESTIGATION,,WITNESS_STATEMENT,a.txt"].join("\n"), () => true);
    assert.match(noFir.errors.join(), /needs a FIR/);
  });
});

describe("importing real case folders", () => {
  before(async () => {
    Object.assign(process.env, { PQC_KEM_SEED: generateSeeds().kemSeed, PQC_DSA_SEED: generateSeeds().dsaSeed });
    dir = await mkdtemp(path.join(tmpdir(), "sakshya-import-")); storeDir = await mkdtemp(path.join(tmpdir(), "sakshya-store-"));
    db = await createPgliteDatabase(); setDbForTests(db); await ensureDemoUsers(db);
    for (const c of ["C01", "C02", "C03"]) await mkdir(path.join(dir, c), { recursive: true });
    const text = (n: number) => Buffer.from("Fictional exhibit text. ".repeat(n));
    await writeFile(path.join(dir, "C01/FIR.txt"), text(200));
    await writeFile(path.join(dir, "C01/Witness_1.txt"), text(80));
    await writeFile(path.join(dir, "C02/FIR.txt"), text(150));
    await writeFile(path.join(dir, "C02/Report.txt"), text(9000)); // ~216 KB → several 64 KiB parts
    await writeFile(path.join(dir, "C02/Charge.txt"), text(120));
    await writeFile(path.join(dir, "C03/FIR.txt"), text(60));
    await writeFile(path.join(dir, "manifest.csv"), [HEADER,
      "C01,GNG,INVESTIGATION,,FIR,C01/FIR.txt", "C01,GNG,INVESTIGATION,,WITNESS_STATEMENT,C01/Witness_1.txt",
      "C02,PCV,TRIAL,complainant@sakshya.demo,FIR,C02/FIR.txt", "C02,PCV,TRIAL,complainant@sakshya.demo,FORENSIC_REPORT,C02/Report.txt", "C02,PCV,TRIAL,complainant@sakshya.demo,CHARGE_SHEET,C02/Charge.txt",
      "C03,NSR,FIR_REGISTERED,,FIR,C03/FIR.txt"].join("\n"));
  });
  after(async () => { setDbForTests(undefined); await db.close(); await rm(dir, { recursive: true, force: true }); await rm(storeDir, { recursive: true, force: true }); });

  it("loads cases as real, verifiable, audited records with system-assigned FIR numbers", async () => {
    const store = new LocalPartStore(storeDir);
    const { report, errors } = await importFromDirectory(dir, { store });
    assert.deepEqual(errors, []);
    assert.equal(report!.cases, 3);
    assert.equal(report!.documents, 6);
    assert.match(report!.firNumbers.C01, /^GNG\/20\d\d\/0001\/[0-9A-F]{4}$/);
    assert.match(report!.firNumbers.C02, /^PCV\/20\d\d\/0001\//);
    assert.match(report!.firNumbers.C03, /^NSR\/20\d\d\/0001\//);

    const judge = demoUserByRole("JUDGE") as SessionUser;
    const cases = await db.withUser(judge.id, async (tx) => (await tx.query("SELECT id, fir_no, stage FROM cases ORDER BY fir_no")).rows);
    const stage = Object.fromEntries(cases.map((c) => [c.fir_no, c.stage]));
    assert.equal(stage[report!.firNumbers.C01], "INVESTIGATION");
    assert.equal(stage[report!.firNumbers.C02], "TRIAL");
    assert.equal(stage[report!.firNumbers.C03], "FIR_REGISTERED");

    // every imported document verifies cleanly (signed by the right officer, parts intact)
    const c02 = cases.find((c) => c.fir_no === report!.firNumbers.C02)!;
    const docs = await listCaseDocuments(judge, c02.id);
    assert.deepEqual(docs.map((d) => d.type).sort(), ["CHARGE_SHEET", "FIR", "FORENSIC_REPORT"]);
    assert.ok(docs.find((d) => d.type === "FORENSIC_REPORT")!.partCount >= 3, "large file is stored as several parts");
    for (const d of docs) {
      const v = await verifyDocumentById(judge, d.id, { store });
      assert.equal(v.status, "UNANCHORED");
      assert.deepEqual(Object.values(v.checks).slice(0, 4), ["pass", "pass", "pass", "pass"]);
      assert.equal((await getDocumentDetail(judge, d.id)).signature.signerName.length > 0, true);
    }
    // complainant sees ONLY their own case milestones, never documents
    const comp = demoUserByRole("COMPLAINANT");
    assert.equal((await db.withUser(comp.id, async (tx) => (await tx.query("SELECT id FROM cases")).rows)).length, 1);
    assert.equal((await db.withUser(comp.id, async (tx) => (await tx.query("SELECT id FROM documents")).rows)).length, 0);
    const stages = await db.withUser(comp.id, async (tx) => (await tx.query("SELECT stage FROM milestones ORDER BY at")).rows.map((r) => r.stage));
    assert.deepEqual(stages, ["FIR_REGISTERED", "INVESTIGATION", "FORENSIC_ANALYSIS", "CHARGE_SHEET_FILED", "TRIAL"]);
  });

  it("refuses unknown stations and non-complainant emails without importing the case", async () => {
    const plan = planFromManifest([HEADER, "Z1,ZZZ,INVESTIGATION,,FIR,C01/FIR.txt", "Z2,GNG,INVESTIGATION,judge@sakshya.demo,FIR,C03/FIR.txt"].join("\n"), () => true);
    const { importPlan } = await import("../lib/import-cases");
    const r = await importPlan(plan.cases, async () => Buffer.from("x".repeat(100)), { store: new LocalPartStore(storeDir) });
    assert.equal(r.cases, 0);
    assert.equal(r.skipped.length, 2);
  });
});
