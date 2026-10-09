import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { GET as casesGet, POST as casesPost } from "../app/api/cases/route";
import { GET as caseGet } from "../app/api/cases/[id]/route";
import { GET as progressGet } from "../app/api/cases/[id]/progress/route";
import { POST as milestonePost } from "../app/api/cases/[id]/milestones/route";
import { GET as firCheck } from "../app/api/fir/check/route";
import { POST as firVerify } from "../app/api/fir/verify-register/route";
import { GET as docsGet, POST as docsPost } from "../app/api/documents/route";
import { GET as docGet } from "../app/api/documents/[id]/route";
import { GET as contentGet } from "../app/api/documents/[id]/content/route";
import { POST as verifyPost } from "../app/api/documents/[id]/verify/route";
import { POST as restorePost } from "../app/api/documents/[id]/restore/route";
import { GET as chainGet } from "../app/api/chain/route";
import { GET as txGet } from "../app/api/chain/transactions/route";
import { GET as publicVerify } from "../app/api/verify/[docId]/route";
import { POST as assistant } from "../app/api/assistant/route";
import { insiderAttack } from "../lib/demo-attack";
import { call, setup, uploadForm, userOf, type Harness } from "./helpers/api";

let h: Harness;
const police = userOf("POLICE").id, police2 = userOf("POLICE", "police2@sakshya.demo").id, lab = userOf("FORENSIC_LAB").id,
  judge = userOf("JUDGE").id, admin = userOf("ADMIN").id, advocate = userOf("DEFENCE_ADVOCATE").id, complainant = userOf("COMPLAINANT").id;
const text = (n: number) => Buffer.from(Array.from({ length: n }, (_, i) => String.fromCharCode(65 + (i % 26))).join(""));
let caseId: string, firNo: string, docId: string;

before(async () => { h = await setup(); });
after(async () => { await h.close(); });

describe("auth gate", () => {
  it("every data route answers 401 without a session", async () => {
    for (const [fn, m] of [[casesGet, "GET"], [casesPost, "POST"], [docsGet, "GET"], [docsPost, "POST"], [chainGet, "GET"], [txGet, "GET"], [firCheck, "GET"], [firVerify, "POST"]] as const) {
      const r = await call(fn, m);
      assert.equal(r.status, 401, `${m}`);
      assert.equal(r.json.error.code, "UNAUTHENTICATED");
    }
  });
  it("deferred routes return 503 FEATURE_DISABLED", async () => {
    for (const [fn, m] of [[publicVerify, "GET"], [assistant, "POST"]] as const) {
      const r = await call(fn, m, { as: police });
      assert.equal(r.status, 503);
      assert.equal(r.json.error.code, "FEATURE_DISABLED");
    }
  });
});

describe("cases", () => {
  it("only POLICE registers a case; the FIR number is assigned, not typed", async () => {
    const denied = await call(casesPost, "POST", { as: judge, body: {} });
    assert.equal(denied.status, 403);
    const r = await call(casesPost, "POST", { as: police, body: { complainantEmail: "complainant@sakshya.demo" } });
    assert.equal(r.status, 200);
    caseId = r.json.id; firNo = r.json.firNo;
    assert.match(firNo, /^GNG\/\d{4}\/0001\/[0-9A-F]{4}$/);
    assert.equal(r.json.stage, "FIR_REGISTERED");
    assert.deepEqual(r.json.allowedUploadTypes.sort(), ["FIR", "WITNESS_STATEMENT"]);
    assert.equal(r.json.canUpload, true);
    assert.equal(r.json.manifest, null);
    assert.equal((await call(casesPost, "POST", { as: police, body: { complainantEmail: "judge@sakshya.demo" } })).status, 422, "email must belong to a complainant");
  });
  it("lists and detail are RLS-scoped; unrelated users get 404 and a DENIED audit entry", async () => {
    const mine = await call(casesGet, "GET", { as: police });
    assert.equal(mine.json.items.length, 1);
    assert.equal(mine.json.items[0].integrity.unchecked, 0);
    assert.equal((await call(casesGet, "GET", { as: police2 })).json.items.length, 0);
    assert.equal((await call(casesGet, "GET", { as: judge })).json.items.length, 1);
    assert.equal((await call(casesGet, "GET", { as: judge, query: { q: "nomatch" } })).json.items.length, 0);
    const other = await call(caseGet, "GET", { as: police2, params: { id: caseId } });
    assert.equal(other.status, 404);
    assert.equal((await call(caseGet, "GET", { as: police, params: { id: "not-a-uuid" } })).status, 422);
    const d = await h.db.withAdmin(async (tx) => (await tx.query("SELECT count(*) AS n FROM audit_log WHERE action = 'DENIED' AND case_id = $1", [caseId])).rows[0].n);
    assert.ok(Number(d) >= 1);
  });
  it("pagination returns a cursor", async () => {
    await call(casesPost, "POST", { as: police, body: {} });
    const p1 = await call(casesGet, "GET", { as: police, query: { limit: "1" } });
    assert.equal(p1.json.items.length, 1);
    assert.ok(p1.json.nextCursor);
    const p2 = await call(casesGet, "GET", { as: police, query: { limit: "1", cursor: p1.json.nextCursor } });
    assert.equal(p2.json.items.length, 1);
    assert.notEqual(p2.json.items[0].id, p1.json.items[0].id);
    assert.equal(p2.json.nextCursor, null);
  });
  it("FIR check confirms genuine numbers and rejects forged ones; register verifies for court only", async () => {
    const ok = await call(firCheck, "GET", { as: complainant, query: { firNo } });
    assert.equal(ok.json.genuine, true);
    assert.equal(ok.json.stationCode, "GNG");
    const forged = await call(firCheck, "GET", { as: police, query: { firNo: firNo.slice(0, -4) + "0000" } });
    assert.equal(forged.json.genuine, false);
    assert.equal(forged.json.issuedAt, null);
    assert.equal((await call(firCheck, "GET", { as: police })).status, 422);
    assert.equal((await call(firVerify, "POST", { as: police })).status, 403);
    const v = await call(firVerify, "POST", { as: admin });
    assert.equal(v.json.status, "pass");
    assert.equal(v.json.checkedEntries, 2);
  });
  it("milestones: police/judge advance the case, never backwards; complainant reads progress only", async () => {
    assert.equal((await call(milestonePost, "POST", { as: complainant, params: { id: caseId }, body: { stage: "INVESTIGATION" } })).status, 403);
    const up = await call(milestonePost, "POST", { as: police, params: { id: caseId }, body: { stage: "INVESTIGATION", note: "Statements being recorded" } });
    assert.equal(up.status, 200);
    assert.equal(up.json.currentStage, "INVESTIGATION");
    assert.equal(up.json.nextExpectedStage, "FORENSIC_ANALYSIS");
    assert.equal(up.json.milestones.length, 2);
    assert.equal((await call(milestonePost, "POST", { as: police, params: { id: caseId }, body: { stage: "FIR_REGISTERED" } })).status, 422, "no going backwards");
    assert.equal((await call(milestonePost, "POST", { as: police, params: { id: caseId }, body: { stage: "BOGUS" } })).status, 422);
    const mine = await call(progressGet, "GET", { as: complainant, params: { id: caseId } });
    assert.equal(mine.status, 200);
    assert.equal(mine.json.firNo, firNo);
    assert.equal("documents" in mine.json, false);
    assert.equal((await call(progressGet, "GET", { as: police2, params: { id: caseId } })).status, 404);
  });
});

describe("documents", () => {
  it("multipart upload returns the receipt; role matrix, size and type are enforced", async () => {
    const ok = await call(docsPost, "POST", { as: police, form: uploadForm(caseId, "FIR", "FIR_0001.txt", text(20_000), "text/plain") });
    assert.equal(ok.status, 201);
    docId = ok.json.document.id;
    assert.equal(ok.json.verification.status, "UNANCHORED");
    assert.equal(ok.json.document.partCount, 1);
    assert.equal((await call(docsPost, "POST", { as: lab, form: uploadForm(caseId, "FIR", "x.txt", "hello", "text/plain") })).status, 403);
    assert.equal((await call(docsPost, "POST", { as: police, form: uploadForm(caseId, "FIR", "big.txt", Buffer.alloc(4_194_305, 65), "text/plain") })).status, 413);
    assert.equal((await call(docsPost, "POST", { as: police, form: uploadForm(caseId, "FIR", "a.exe", "MZ", "application/x-msdownload") })).status, 422);
    assert.equal((await call(docsPost, "POST", { as: police, form: uploadForm(caseId, "NOPE", "a.txt", "x", "text/plain") })).status, 422);
    assert.equal((await call(docsPost, "POST", { as: police, body: { x: 1 } })).status, 422, "JSON is not multipart");
    assert.equal((await call(docsPost, "POST", { as: police2, form: uploadForm(caseId, "FIR", "x.txt", "hello", "text/plain") })).status, 404, "unassigned officer cannot see the case");
  });
  it("list + detail + versions + chain feed", async () => {
    const l = await call(docsGet, "GET", { as: judge, query: { caseId } });
    assert.equal(l.json.items.length, 1);
    assert.equal((await call(docsGet, "GET", { as: police })).status, 422);
    assert.equal((await call(docsGet, "GET", { as: advocate, query: { caseId } })).status, 404, "advocate has no access without a grant");
    const d = await call(docGet, "GET", { as: police, params: { id: docId } });
    assert.equal(d.json.signature.algorithm, "ML-DSA-65");
    assert.equal(d.json.access.via, "ROLE");
    assert.equal(d.json.canAddVersion, true);
    assert.deepEqual(d.json.chain, []);
    assert.equal((await call(docGet, "GET", { as: police2, params: { id: docId } })).status, 404);
    const caseView = await call(caseGet, "GET", { as: judge, params: { id: caseId } });
    assert.equal(caseView.json.documentCount, 1);
    assert.equal(caseView.json.manifest.version, 1);
    assert.equal(caseView.json.canAssemble, true);
  });
  it("content is verified first, audited, and served with safe headers", async () => {
    const r = await call(contentGet, "GET", { as: judge, params: { id: docId }, query: { disposition: "attachment" } });
    assert.equal(r.status, 200);
    assert.equal(r.res.headers.get("cache-control"), "no-store");
    assert.equal(r.res.headers.get("x-content-type-options"), "nosniff");
    assert.match(r.res.headers.get("content-disposition")!, /^attachment; filename="FIR_0001.txt"/);
    assert.deepEqual(Buffer.from(await r.res.arrayBuffer()), text(20_000));
    assert.equal((await call(contentGet, "GET", { as: judge, params: { id: docId }, query: { disposition: "bogus" } })).status, 422);
    assert.equal((await call(contentGet, "GET", { as: advocate, params: { id: docId } })).status, 404);
    assert.equal((await call(contentGet, "GET", { as: complainant, params: { id: docId } })).status, 404);
  });
  it("verify, tamper detection, withheld content and restore as a new version", async () => {
    const v = await call(verifyPost, "POST", { as: judge, params: { id: docId } });
    assert.equal(v.json.status, "UNANCHORED");
    assert.equal(v.json.checks.signature, "pass");
    await insiderAttack(docId, 9000);
    const bad = await call(verifyPost, "POST", { as: judge, params: { id: docId } });
    assert.equal(bad.json.status, "TAMPERED");
    assert.equal(bad.json.tamperRanges[0].chunkIndex, 2);
    assert.equal(bad.json.originalVersionAvailable, true);
    const withheld = await call(contentGet, "GET", { as: police, params: { id: docId } });
    assert.equal(withheld.status, 409);
    assert.equal(withheld.json.error.code, "TAMPERED");
    assert.equal((await call(restorePost, "POST", { as: judge, params: { id: docId }, body: { reason: "restore it" } })).status, 403, "court roles are read-only on evidence");
    assert.equal((await call(restorePost, "POST", { as: police, params: { id: docId }, body: {} })).status, 422);
    const rest = await call(restorePost, "POST", { as: police, params: { id: docId }, body: { reason: "Restored after integrity alarm" } });
    assert.equal(rest.status, 201);
    assert.equal(rest.json.document.version, 2);
    assert.equal(rest.json.document.parentId, docId);
    const detail = await call(docGet, "GET", { as: police, params: { id: rest.json.document.id } });
    assert.equal(detail.json.versions.length, 2);
    const fine = await call(contentGet, "GET", { as: police, params: { id: rest.json.document.id } });
    assert.equal(fine.status, 200);
    assert.deepEqual(Buffer.from(await fine.res.arrayBuffer()), text(20_000));
  });
});

describe("chain routes without a configured chain", () => {
  it("GET /api/chain is 503 CHAIN_UNAVAILABLE; the transaction feed is an empty page", async () => {
    const c = await call(chainGet, "GET", { as: judge });
    assert.equal(c.status, 503);
    assert.equal(c.json.error.code, "CHAIN_UNAVAILABLE");
    const t = await call(txGet, "GET", { as: judge });
    assert.deepEqual(t.json, { items: [], nextCursor: null });
    assert.equal((await call(txGet, "GET", { as: judge, query: { docId: "nope" } })).status, 422);
  });
});

describe("FIR written in the browser", () => {
  it("an officer can write the FIR in the browser: the text becomes the case's first document", async () => {
    const r = await call(casesPost, "POST", { as: police, body: { firText: "On 9 Oct 2026 the complainant reported the theft of a motorcycle from Gangapur Road." } });
    assert.equal(r.status, 200);
    assert.equal(r.json.documentCount, 1);
    const docs = await call(docsGet, "GET", { as: police, query: { caseId: r.json.id } });
    assert.equal(docs.json.items[0].type, "FIR");
    assert.equal(docs.json.items[0].filename, "FIR.txt");
    const body = await call(contentGet, "GET", { as: police, params: { id: docs.json.items[0].id } });
    assert.match(Buffer.from(await body.res.arrayBuffer()).toString(), /theft of a motorcycle/);
    assert.equal((await call(casesPost, "POST", { as: police, body: { firText: "x".repeat(20_001) } })).status, 422);
  });
});
