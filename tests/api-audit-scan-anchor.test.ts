import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { POST as casesPost } from "../app/api/cases/route";
import { POST as docsPost } from "../app/api/documents/route";
import { POST as verifyPost } from "../app/api/documents/[id]/verify/route";
import { GET as docGet } from "../app/api/documents/[id]/route";
import { GET as auditGet } from "../app/api/audit/route";
import { POST as auditVerify } from "../app/api/audit/verify/route";
import { POST as scanPost } from "../app/api/integrity/scans/route";
import { GET as scanGet } from "../app/api/integrity/scans/[id]/route";
import { GET as batchesGet } from "../app/api/batches/route";
import { GET as txGet } from "../app/api/chain/transactions/route";
import { GET as chainGet } from "../app/api/chain/route";
import { anchorPending } from "../lib/anchoring";
import { setChainForTests } from "../lib/chain";
import { insiderAttack } from "../lib/demo-attack";
import { call, setup, uploadForm, userOf, type Harness } from "./helpers/api";
import { fakeChain } from "./helpers/fake-chain";

let h: Harness;
const police = userOf("POLICE").id, lab = userOf("FORENSIC_LAB").id, judge = userOf("JUDGE").id, admin = userOf("ADMIN").id,
  prosecutor = userOf("PUBLIC_PROSECUTOR").id;
const text = (n: number, k = 0) => Buffer.from(Array.from({ length: n }, (_, i) => String.fromCharCode(65 + ((i + k) % 26))).join(""));
let caseId: string; const docs: string[] = [];
const chain = fakeChain();

before(async () => {
  h = await setup();
  caseId = (await call(casesPost, "POST", { as: police, body: {} })).json.id;
  await h.db.withUser(police, (tx) => tx.query("SELECT assign_user($1,$2)", [caseId, lab]));
  for (let k = 0; k < 3; k++) {
    const r = await call(docsPost, "POST", { as: police, form: uploadForm(caseId, "WITNESS_STATEMENT", `stmt_${k}.txt`, text(10_000 + k * 5000, k), "text/plain") });
    docs.push(r.json.document.id);
  }
});
after(async () => { await h.close(); });

describe("audit explorer", () => {
  it("court browses and filters everything; others are refused without a document", async () => {
    const all = await call(auditGet, "GET", { as: judge, query: { limit: "200" } });
    assert.equal(all.status, 200);
    const actions = new Set(all.json.items.map((e: { action: string }) => e.action));
    assert.ok(actions.has("UPLOAD") && actions.has("MANIFEST_SEALED"));
    assert.equal(all.json.items[0].seq > all.json.items.at(-1).seq, true, "newest first");
    for (const e of all.json.items) assert.ok(e.legalBasis.code && e.entryHash.length === 64 && e.prevHash.length === 64);
    const uploads = await call(auditGet, "GET", { as: admin, query: { action: "UPLOAD", caseId } });
    assert.equal(uploads.json.items.length, 3);
    assert.equal((await call(auditGet, "GET", { as: judge, query: { action: "BOGUS" } })).status, 422);
    assert.equal((await call(auditGet, "GET", { as: judge, query: { from: "yesterday-ish" } })).status, 422);
    assert.equal((await call(auditGet, "GET", { as: police })).status, 403);
    const future = await call(auditGet, "GET", { as: judge, query: { from: "2999-01-01T00:00:00Z" } });
    assert.equal(future.json.items.length, 0);
  });
  it("assigned staff get the custody trail of a document they can read; strangers do not", async () => {
    const trail = await call(auditGet, "GET", { as: lab, query: { docId: docs[0] } });
    assert.equal(trail.status, 200);
    assert.ok(trail.json.items.some((e: { action: string }) => e.action === "UPLOAD"));
    assert.equal((await call(auditGet, "GET", { as: userOf("POLICE", "police2@sakshya.demo").id, query: { docId: docs[0] } })).status, 404);
    assert.equal((await call(auditGet, "GET", { as: userOf("COMPLAINANT").id, query: { docId: docs[0] } })).status, 404);
  });
  it("verify recomputes the chain (court only) and detects an altered entry", async () => {
    assert.equal((await call(auditVerify, "POST", { as: police })).status, 403);
    const ok = await call(auditVerify, "POST", { as: judge });
    assert.equal(ok.json.status, "pass");
    assert.ok(ok.json.checkedEntries > 5);
    assert.equal(ok.json.headHash.length, 64);
    assert.equal(ok.json.headAnchored, false);
    // an insider with raw database access rewrites one entry (triggers disabled to simulate it)
    const victim = (await h.db.withAdmin(async (tx) => (await tx.query("SELECT id FROM audit_log WHERE action = 'UPLOAD' ORDER BY seq LIMIT 1")).rows[0].id)) as string;
    await h.db.withAdmin(async (tx) => {
      await tx.query("ALTER TABLE audit_log DISABLE TRIGGER audit_append_only");
      await tx.query("UPDATE audit_log SET detail = 'nothing to see here' WHERE id = $1", [victim]);
      await tx.query("ALTER TABLE audit_log ENABLE TRIGGER audit_append_only");
    });
    const bad = await call(auditVerify, "POST", { as: admin });
    assert.equal(bad.json.status, "fail");
    assert.equal(bad.json.firstBrokenEntryId, victim);
    // restore the original text so later tests start from an intact chain
    await h.db.withAdmin(async (tx) => {
      await tx.query("ALTER TABLE audit_log DISABLE TRIGGER audit_append_only");
      await tx.query("UPDATE audit_log SET detail = 'WITNESS_STATEMENT v1' WHERE id = $1", [victim]);
      await tx.query("ALTER TABLE audit_log ENABLE TRIGGER audit_append_only");
    });
    assert.equal((await call(auditVerify, "POST", { as: judge })).json.status, "pass");
  });
});

describe("integrity scans", () => {
  it("court-only synchronous scan: clean, then localises a tampered document", async () => {
    assert.equal((await call(scanPost, "POST", { as: police, body: {} })).status, 403);
    assert.equal((await call(scanPost, "POST", { as: judge, body: { caseId: "nope" } })).status, 422);
    const clean = await call(scanPost, "POST", { as: judge, body: { caseId } });
    assert.equal(clean.status, 200);
    assert.equal(clean.json.status, "completed");
    assert.equal(clean.json.total, 3);
    assert.equal(clean.json.checked, 3);
    assert.ok(clean.json.results.every((r: { verification: { status: string } }) => r.verification.status === "UNANCHORED"));

    await insiderAttack(docs[1], 9000);
    const dirty = await call(scanPost, "POST", { as: admin, body: {} });
    assert.equal(dirty.json.results.length, 3);
    const bad = dirty.json.results.find((r: { document: { id: string } }) => r.document.id === docs[1]);
    assert.equal(bad.verification.status, "TAMPERED");
    assert.equal(bad.verification.tamperRanges[0].chunkIndex, 2);
    assert.equal(bad.document.verificationStatus, "TAMPERED");
    const reopened = await call(scanGet, "GET", { as: judge, params: { id: dirty.json.id } });
    assert.equal(reopened.json.results.length, 3);
    assert.equal((await call(scanGet, "GET", { as: prosecutor, params: { id: dirty.json.id } })).status, 403);
    assert.equal((await call(scanGet, "GET", { as: judge, params: { id: "00000000-0000-4000-8000-000000000000" } })).status, 404);
    const audit = await call(auditGet, "GET", { as: judge, query: { caseId, limit: "200" } });
    const acts = audit.json.items.map((e: { action: string }) => e.action);
    assert.ok(acts.includes("SCAN") && acts.includes("TAMPER_DETECTED"));
  });
});

describe("batch anchoring and the on-chain root", () => {
  it("without a chain nothing is anchored", async () => {
    assert.equal(await anchorPending({ chainService: null }), null);
    const list = await call(batchesGet, "GET", { as: judge });
    assert.deepEqual(list.json, { items: [], nextCursor: null });
    assert.equal((await call(batchesGet, "GET", { as: police })).status, 403);
  });

  it("anchors a Merkle batch: documents hold proofs, the chain holds the root, verification becomes VERIFIED", async () => {
    // restore the tampered part so the three documents are intact again (re-upload identical bytes under the same address)
    const dirs = await h.db.withAdmin(async (tx) => (await tx.query("SELECT address FROM document_parts WHERE doc_id = $1", [docs[1]])).rows);
    const { getPartStore } = await import("../lib/storage/part-store");
    const store = getPartStore();
    for (const d of dirs) { const original = await store.getOriginal(d.address); await (store.unsafeOverwriteForDemo!(d.address, original!)); }

    const r = await anchorPending({ chainService: chain.service });
    assert.ok(r);
    assert.equal(r.docCount, 3);
    assert.equal(r.confirmed, true);
    assert.equal(chain.registry.batches.get(r.batchId)?.root, `0x${r.root}`);
    assert.equal(await anchorPending({ chainService: chain.service }), null, "nothing left to anchor");

    setChainForTests(chain.service);
    for (const id of docs) {
      const v = await call(verifyPost, "POST", { as: judge, params: { id } });
      assert.equal(v.json.status, "VERIFIED", id);
      assert.equal(v.json.checks.merkleProof, "pass");
      assert.equal(v.json.checks.onChainRoot, "pass");
      assert.equal(v.json.anchor.batchId, r.batchId);
      assert.equal(v.json.anchor.root, `0x${r.root}`);
      assert.match(v.json.anchor.explorerUrl, /^https:\/\/sepolia\.etherscan\.io\/tx\/0x[0-9a-f]{64}$/);
    }
    const list = await call(batchesGet, "GET", { as: admin });
    assert.equal(list.json.items.length, 1);
    assert.equal(list.json.items[0].status, "confirmed");
    assert.equal(list.json.items[0].documentCount, 3);
    assert.match(list.json.items[0].root, /^0x[0-9a-f]{64}$/);
    assert.match(list.json.items[0].explorerUrl, /sepolia\.etherscan\.io/);
    const info = await call(chainGet, "GET", { as: judge });
    assert.equal(info.json.network, "sepolia");
    assert.match(info.json.explorerAddressUrl, /address\/0x149A/);
    const feed = await call(txGet, "GET", { as: judge });
    assert.ok(feed.json.items.some((t: { kind: string; status: string }) => t.kind === "ANCHOR_BATCH" && t.status === "confirmed"));
    const detail = await call(docGet, "GET", { as: police, params: { id: docs[0] } });
    assert.ok(detail.json.chain.length >= 0);
    const chk = await call(auditVerify, "POST", { as: judge });
    assert.equal(chk.json.headAnchored, true, "the anchored batch committed to an audit entry that is still intact");
  });

  it("a root on-chain that differs from the stored proof root is reported as TAMPERED", async () => {
    chain.registry.batches.set(1, { root: `0x${"ab".repeat(32)}`, anchoredAt: 1_800_000_001 });
    // fresh service instance: its root cache is empty
    const { service } = { service: new (chain.service.constructor as typeof import("../lib/chain").ChainService)(chain.service.profile, chain.registry, chain.service.registryAddress) };
    setChainForTests(service);
    const v = await call(verifyPost, "POST", { as: judge, params: { id: docs[0] } });
    assert.equal(v.json.status, "TAMPERED");
    assert.equal(v.json.checks.onChainRoot, "fail");
    setChainForTests(chain.service);
  });

  it("an unconfirmed anchor is retried with the same batch id", async () => {
    const c2 = fakeChain();
    const r1 = await call(docsPost, "POST", { as: police, form: uploadForm(caseId, "WITNESS_STATEMENT", "late.txt", text(2000, 9), "text/plain") });
    assert.equal(r1.status, 201);
    c2.registry.failNext = true; c2.registry.failedOnce = true;
    const first = await anchorPending({ chainService: c2.service });
    assert.ok(first);
    assert.equal(first.confirmed, false);
    c2.registry.failedOnce = false;
    const second = await anchorPending({ chainService: c2.service });
    assert.ok(second);
    assert.equal(second.batchId, first.batchId, "same batch is re-sent, not a new one");
    assert.equal(second.confirmed, true);
    assert.equal(second.docCount, 1);
  });
});
