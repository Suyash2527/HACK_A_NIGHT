import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { insiderAttack } from "../lib/demo-attack";
import { createPgliteDatabase, setDbForTests, type Database } from "../lib/db";
import { DEMO_USERS, demoUserByRole } from "../lib/demo-users";
import { ApiError } from "../lib/errors";
import { getDocumentDetail, listCaseDocuments, readContent, restoreDocument, uploadDocument, verifyDocumentById } from "../lib/evidence";
import { generateSeeds } from "../lib/crypto/pqc";
import { ensureDemoUsers } from "../lib/seed";
import type { SessionUser } from "../lib/session";
import { LocalPartStore } from "../lib/storage/part-store";

let db: Database; let store: LocalPartStore; let dir: string;
const U = (role: Parameters<typeof demoUserByRole>[0]) => demoUserByRole(role) as SessionUser;
const police = U("POLICE"), lab = U("FORENSIC_LAB"), judge = U("JUDGE"), advocate = U("DEFENCE_ADVOCATE"), police2 = U("POLICE");
let caseId: string; let otherCase: string;

const text = (n: number) => Buffer.from(Array.from({ length: n }, (_, i) => String.fromCharCode(65 + (i % 26))).join(""));
const upload = (u: SessionUser, over: Partial<Parameters<typeof uploadDocument>[1]> = {}) =>
  uploadDocument(u, { caseId, type: "FIR", filename: "FIR_0142.txt", mimeType: "text/plain", bytes: text(20_000), ...over }, { store });
const code = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e instanceof ApiError ? e.code : `non-api:${(e as Error).message}`; } return "OK"; };

before(async () => {
  Object.assign(process.env, { ...(() => { const s = generateSeeds(); return { PQC_KEM_SEED: s.kemSeed, PQC_DSA_SEED: s.dsaSeed }; })(), SAKSHYA_ALLOW_ATTACK_IN_TESTS: "1" });
  dir = await mkdtemp(path.join(tmpdir(), "sakshya-ev-"));
  store = new LocalPartStore(dir);
  db = await createPgliteDatabase(); setDbForTests(db); await ensureDemoUsers(db);
  caseId = (await db.withUser(police.id, async (tx) => (await tx.query("SELECT case_id AS id FROM create_case($1)", [demoUserByRole("COMPLAINANT").id])).rows[0].id)) as string;
  otherCase = (await db.withUser(DEMO_USERS.find((u) => u.email.startsWith("police2"))!.id, async (tx) => (await tx.query("SELECT case_id AS id FROM create_case()")).rows[0].id)) as string;
  await db.withUser(police.id, (tx) => tx.query("SELECT assign_user($1,$2)", [caseId, lab.id]));
  void police2;
});
after(async () => { setDbForTests(undefined); await db.close(); await rm(dir, { recursive: true, force: true }); });

describe("upload", () => {
  it("seals, signs, stores ciphertext only, audits and seals a case manifest", async () => {
    const r = await upload(police);
    assert.equal(r.document.version, 1);
    assert.equal(r.document.partCount, 1);
    assert.equal(r.encryption, "AES-256-GCM");
    assert.equal(r.keyWrapping, "ML-KEM-768");
    assert.equal(r.verification.status, "UNANCHORED");
    const stored = await db.withAdmin(async (tx) => (await tx.query("SELECT address FROM document_parts WHERE doc_id = $1", [r.document.id])).rows);
    const obj = (await store.get(stored[0].address))!;
    assert.equal(obj.includes(text(64)), false, "no plaintext in storage");
    const m = await db.withAdmin(async (tx) => (await tx.query("SELECT version, doc_count FROM case_manifests WHERE case_id = $1", [caseId])).rows);
    assert.deepEqual(m.map((x) => [Number(x.version), Number(x.doc_count)]), [[1, 1]]);
    const a = await db.withAdmin(async (tx) => (await tx.query("SELECT action FROM audit_log WHERE doc_id = $1 OR case_id = $2 ORDER BY seq", [r.document.id, caseId])).rows.map((x) => x.action));
    assert.deepEqual(a, ["UPLOAD", "MANIFEST_SEALED"]);
  });

  it("enforces role matrix, case assignment, size, type and name rules", async () => {
    assert.equal(await code(upload(lab)), "FORBIDDEN"); // lab cannot upload a FIR
    assert.equal(await code(upload(judge)), "FORBIDDEN");
    assert.equal(await code(upload(advocate)), "FORBIDDEN");
    assert.equal(await code(upload(lab, { caseId: otherCase, type: "FORENSIC_REPORT", filename: "r.pdf", mimeType: "application/pdf" })), "NOT_FOUND"); // unassigned case is invisible
    assert.equal(await code(upload(police, { bytes: Buffer.alloc(4_194_305, 1) })), "TOO_LARGE");
    assert.equal(await code(upload(police, { bytes: Buffer.alloc(0) })), "VALIDATION");
    assert.equal(await code(upload(police, { mimeType: "application/x-msdownload", filename: "a.exe" })), "VALIDATION");
    assert.equal(await code(upload(police, { filename: "FIR.pdf" })), "VALIDATION"); // extension must match MIME
    const denied = await db.withAdmin(async (tx) => (await tx.query("SELECT count(*) AS n FROM audit_log WHERE action = 'DENIED'")).rows[0].n);
    assert.ok(Number(denied) >= 1, "refused uploads are audited as DENIED");
  });

  it("a correction becomes version 2 linked to its parent; lineage is visible", async () => {
    const v1 = (await listCaseDocuments(police, caseId))[0];
    const v2 = await upload(police, { parentId: v1.id, bytes: text(20_100) });
    assert.equal(v2.document.version, 2);
    assert.equal(v2.document.parentId, v1.id);
    const detail = await getDocumentDetail(police, v2.document.id);
    assert.deepEqual(detail.versions.map((v) => v.version), [1, 2]);
    assert.equal(await code(upload(police, { parentId: "00000000-0000-4000-8000-0000000000ff" })), "VALIDATION");
  });

  it("multi-part files (> 64 KiB) are stored as several parts", async () => {
    const r = await upload(police, { type: "WITNESS_STATEMENT", filename: "stmt.txt", bytes: text(150_000) });
    assert.equal(r.document.partCount, 3);
  });
});

describe("verification & view", () => {
  let docId: string;
  before(async () => { docId = (await upload(police, { filename: "FIR_attack.txt", bytes: text(50 * 1024) })).document.id; });

  it("a clean document is UNANCHORED with all content checks passing and a retained original", async () => {
    const v = await verifyDocumentById(police, docId, { store });
    assert.equal(v.status, "UNANCHORED");
    assert.deepEqual([v.checks.decrypt, v.checks.plaintextHash, v.checks.chunkRoot, v.checks.signature], ["pass", "pass", "pass", "pass"]);
    assert.equal(v.originalVersionAvailable, true);
    assert.deepEqual(v.tamperRanges, []);
    assert.ok(v.lastAccessors.length >= 1);
  });

  it("assigned staff read it, court reads it, strangers/complainant/advocate are refused (and audited)", async () => {
    const a = await readContent(lab, docId, "inline", { store });
    assert.equal(a.bytes.length, 50 * 1024);
    assert.equal((await readContent(judge, docId, "attachment", { store })).sha256.length, 64);
    for (const u of [U("COMPLAINANT"), advocate, DEMO_USERS.find((x) => x.email.startsWith("police2")) as SessionUser])
      assert.equal(await code(readContent(u, docId, "inline", { store })), "NOT_FOUND");
    const denied = await db.withAdmin(async (tx) => (await tx.query("SELECT count(*) AS n FROM audit_log WHERE action = 'DENIED' AND doc_id = $1", [docId])).rows[0].n);
    assert.ok(Number(denied) >= 3);
  });

  it("INSIDER ATTACK: one byte at offset 9000 → TAMPERED, exact chunk, content withheld, original recoverable", async () => {
    const report = await insiderAttack(docId, 9000, store);
    assert.equal(report.partIndex, 0);
    const v = await verifyDocumentById(judge, docId, { store });
    assert.equal(v.status, "TAMPERED");
    assert.equal(v.checks.decrypt, "pass", "authenticated decryption cannot see this attack");
    assert.equal(v.checks.plaintextHash, "fail");
    assert.equal(v.checks.chunkRoot, "fail");
    assert.equal(v.checks.signature, "pass");
    assert.deepEqual(v.tamperRanges, [{ chunkIndex: 2, byteStart: 8192, byteEnd: 12287, kind: "modified" }]);
    assert.equal(v.parts![0].status, "fail");
    assert.equal(v.originalVersionAvailable, true);
    assert.ok(v.lastAccessors.length >= 2);
    // content is withheld for everyone, with the TAMPERED envelope
    assert.equal(await code(readContent(police, docId, "inline", { store })), "TAMPERED");
    const acts = await db.withAdmin(async (tx) => (await tx.query("SELECT action FROM audit_log WHERE doc_id = $1 ORDER BY seq", [docId])).rows.map((r) => r.action));
    assert.ok(acts.includes("TAMPER_DETECTED"));
    // the tampered state is what the UI list shows next
    const listed = (await listCaseDocuments(police, caseId)).find((d) => d.id === docId)!;
    assert.equal(listed.verificationStatus, "TAMPERED");
  });

  it("RESTORE: appends a new verified version from the retained original; the damaged version stays on record", async () => {
    assert.equal(await code(restoreDocument(judge, docId, "court cannot restore evidence", { store })), "FORBIDDEN");
    assert.equal(await code(restoreDocument(lab, docId, "wrong role", { store })), "FORBIDDEN");
    assert.equal(await code(restoreDocument(police, docId, "no", { store })), "VALIDATION"); // reason too short
    const r = await restoreDocument(police, docId, "Recover retained original after integrity incident", { store });
    assert.equal(r.document.parentId, docId);
    assert.equal(r.document.version, 2);
    const fresh = await verifyDocumentById(police, r.document.id, { store });
    assert.equal(fresh.status, "UNANCHORED");
    assert.deepEqual(Object.values(fresh.checks).slice(0, 4), ["pass", "pass", "pass", "pass"]);
    assert.equal((await readContent(police, r.document.id, "inline", { store })).bytes.length, 50 * 1024);
    const damaged = await verifyDocumentById(police, docId, { store });
    assert.equal(damaged.status, "TAMPERED", "the damaged version keeps its red status");
    const acts = await db.withAdmin(async (tx) => (await tx.query("SELECT action FROM audit_log WHERE doc_id = $1", [r.document.id])).rows.map((x) => x.action));
    assert.ok(acts.includes("RESTORE"));
    const detail = await getDocumentDetail(police, r.document.id);
    assert.deepEqual(detail.versions.map((v) => v.version), [1, 2]);
  });

  it("a part that is deleted from storage is reported, not crashed on", async () => {
    const id = (await upload(police, { filename: "gone.txt", bytes: text(70_000) })).document.id;
    const addr = await db.withAdmin(async (tx) => (await tx.query("SELECT address FROM document_parts WHERE doc_id = $1 AND idx = 1", [id])).rows[0].address);
    await rm(path.join(dir, addr.slice(0, 2), addr));
    const v = await verifyDocumentById(police, id, { store });
    assert.equal(v.status, "TAMPERED");
    assert.deepEqual(v.parts!.map((p) => p.status), ["pass", "fail"]);
    assert.equal(await code(readContent(police, id, "inline", { store })), "TAMPERED");
  });

  it("random garbage written over a part is also caught", async () => {
    const id = (await upload(police, { filename: "garbage.txt", bytes: text(5000) })).document.id;
    const addr = await db.withAdmin(async (tx) => (await tx.query("SELECT address FROM document_parts WHERE doc_id = $1", [id])).rows[0].address);
    await store.unsafeOverwriteForDemo(addr, randomBytes(200));
    const v = await verifyDocumentById(police, id, { store });
    assert.equal(v.status, "TAMPERED");
    assert.equal(v.checks.decrypt, "fail");
  });
});
