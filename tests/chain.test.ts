import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Interface } from "ethers";
import { CHAINS } from "../contracts/config/networks";
import { REGISTRY_ABI } from "../lib/chain-abi";
import { ChainService, actorHashFor, caseRefFor, recordIdFor, type RegistryLike, type TxLike, type TxRow, type TxStore } from "../lib/chain";
import { createPgliteDatabase, setDbForTests, type Database } from "../lib/db";
import { demoUserByRole } from "../lib/demo-users";
import { generateSeeds } from "../lib/crypto/pqc";
import { insiderAttack } from "../lib/demo-attack";
import { restoreDocument, uploadDocument, verifyDocumentById } from "../lib/evidence";
import { ensureDemoUsers } from "../lib/seed";
import type { SessionUser } from "../lib/session";
import { LocalPartStore } from "../lib/storage/part-store";

const iface = new Interface(REGISTRY_ABI as unknown as string[]);
const calls: { fn: string; args: unknown[] }[] = [];
let n = 0;
const tx = (): TxLike => ({ hash: `0x${(++n).toString(16).padStart(64, "0")}`, wait: async () => ({ blockNumber: 100 + n, status: 1 }) });
/** Fake registry that ALSO proves every call is valid against the real ABI (encodeFunctionData throws on a wrong shape). */
const registry = (failOn?: string): RegistryLike => new Proxy({} as RegistryLike, {
  get: (_t, fn: string) => async (...args: unknown[]) => {
    iface.encodeFunctionData(fn, args);
    calls.push({ fn, args });
    if (fn === failOn) throw new Error("rpc down");
    return tx();
  },
});
const memStore = () => { const rows: TxRow[] = []; const status: Record<string, string> = {}; const s: TxStore = {
  insert: async (r) => { rows.push(r); }, setStatus: async (h, st) => { status[h] = st; } }; return { rows, status, s }; };

describe("ChainService", () => {
  it("sends well-formed, ABI-valid transactions and records each one", async () => {
    calls.length = 0;
    const m = memStore(); const svc = new ChainService(CHAINS.sepolia, registry(), "0x" + "ab".repeat(20), m.s);
    const docId = randomUUID(), caseId = randomUUID(), h = "a".repeat(64);
    void svc.registerRecord({ docId, caseId, filename: "FIR.pdf", version: 1, sha256: h, chunkRoot: h, signatureB64: "c2ln", signerKeyHash: h });
    void svc.attestSignature({ docId, caseId, filename: "FIR.pdf", valid: true, evidence: "{}" });
    void svc.sealCaseManifest({ caseId, firNo: "GNG/2026/0001/ABCD", version: 1, root: h, documentCount: 1 });
    void svc.auditEvent({ subject: { docId, caseId }, action: "TAMPER_DETECTED", actorId: randomUUID(), entryHash: h, label: "tamper" });
    void svc.anchorBatch({ batchId: 7, root: h, signatureHash: h, docCount: 3 });
    await svc.idle();
    assert.deepEqual(calls.map((c) => c.fn), ["registerRecord", "attestSignature", "sealCaseManifest", "logAuditEvent", "anchorBatch"], "serial order preserved");
    assert.deepEqual(m.rows.map((r) => r.kind), ["REGISTER_RECORD", "ATTEST_SIGNATURE", "SEAL_MANIFEST", "AUDIT_EVENT", "ANCHOR_BATCH"]);
    assert.ok(m.rows.every((r) => r.chainId === 11155111));
    assert.ok(Object.values(m.status).every((s) => s === "confirmed"));
    assert.equal(calls[0].args[0], recordIdFor(docId));
    assert.equal(calls[2].args[0], caseRefFor(caseId));
    assert.equal(calls[3].args[1], 7, "TAMPER_DETECTED action index matches the contract enum");
  });

  it("a failing RPC never throws to the caller and later jobs still run", async () => {
    calls.length = 0;
    const m = memStore(); const svc = new ChainService(CHAINS.local, registry("attestSignature"), "0x" + "cd".repeat(20), m.s);
    const docId = randomUUID(), caseId = randomUUID(), h = "b".repeat(64);
    await svc.attestSignature({ docId, caseId, filename: "x", valid: true, evidence: "e" });   // fails inside, must not reject
    await svc.sealCaseManifest({ caseId, firNo: "X", version: 1, root: h, documentCount: 1 });  // still sent
    await svc.idle();
    assert.deepEqual(m.rows.map((r) => r.kind), ["SEAL_MANIFEST"]);
  });

  it("only pseudonymous hashes are used for identities (no raw ids or names on chain)", () => {
    const uid = randomUUID();
    const a = actorHashFor(uid, "salt1"), b = actorHashFor(uid, "salt2");
    assert.match(a, /^0x[0-9a-f]{64}$/);
    assert.notEqual(a, b, "salted");
    assert.ok(!a.includes(uid.replace(/-/g, "")));
    assert.notEqual(recordIdFor(uid), caseRefFor(uid), "documents and cases use separate namespaces");
  });

  it("exposes registry + explorer info for the UI trust strip", () => {
    const sep = new ChainService(CHAINS.sepolia, registry(), "0x" + "ee".repeat(20), memStore().s).info();
    assert.equal(sep.network, "sepolia"); assert.equal(sep.chainId, 11155111);
    assert.match(sep.explorerAddressUrl!, /^https:\/\/sepolia\.etherscan\.io\/address\/0x/);
    assert.equal(new ChainService(CHAINS.local, registry(), "0x" + "ee".repeat(20), memStore().s).info().explorerAddressUrl, null);
    assert.equal(new ChainService(CHAINS.sepolia, registry(), "0x", memStore().s).explorerUrl("0x" + "1".repeat(64)), "https://sepolia.etherscan.io/tx/0x" + "1".repeat(64));
  });
});

describe("evidence flow emits the right on-chain transactions", () => {
  let db: Database; let dir: string; let store: LocalPartStore; let caseId: string;
  const police = demoUserByRole("POLICE") as SessionUser;
  before(async () => {
    Object.assign(process.env, { PQC_KEM_SEED: generateSeeds().kemSeed, PQC_DSA_SEED: generateSeeds().dsaSeed, SAKSHYA_ALLOW_ATTACK_IN_TESTS: "1" });
    dir = await mkdtemp(path.join(tmpdir(), "sakshya-chain-")); store = new LocalPartStore(dir);
    db = await createPgliteDatabase(); setDbForTests(db); await ensureDemoUsers(db);
    caseId = (await db.withUser(police.id, async (t) => (await t.query("SELECT case_id AS id FROM create_case()")).rows[0].id)) as string;
  });
  after(async () => { setDbForTests(undefined); await db.close(); await rm(dir, { recursive: true, force: true }); });

  it("upload → register + attest + seal folder; tamper → audit event; restore → register (linked to parent) + audit event", async () => {
    calls.length = 0;
    const svc = new ChainService(CHAINS.sepolia, registry(), "0x" + "99".repeat(20), memStore().s);
    const deps = { store, chainService: svc };
    const bytes = Buffer.from("Fictional FIR text. ".repeat(3000));
    const up = await uploadDocument(police, { caseId, type: "FIR", filename: "FIR_0142.txt", mimeType: "text/plain", bytes }, deps);
    await svc.idle();
    assert.deepEqual(calls.map((c) => c.fn), ["registerRecord", "attestSignature", "sealCaseManifest"]);
    const input = calls[0].args[1] as unknown as Record<string, unknown>;
    assert.equal(input.version, 1);
    assert.equal(input.parentRecordId, `0x${"0".repeat(64)}`);
    assert.equal(input.documentHash, `0x${up.document.sha256}`);
    assert.equal(calls[1].args[1], 1, "verdict Valid");
    assert.equal(calls[2].args[1], 1, "manifest version 1");

    calls.length = 0;
    await insiderAttack(up.document.id, 9000, store);
    const v = await verifyDocumentById(police, up.document.id, deps);
    await svc.idle();
    assert.equal(v.status, "TAMPERED");
    assert.deepEqual(calls.map((c) => c.fn), ["logAuditEvent"]);
    assert.equal(calls[0].args[0], recordIdFor(up.document.id));
    assert.equal(calls[0].args[1], 7);

    calls.length = 0;
    const r = await restoreDocument(police, up.document.id, "Recover retained original after incident", deps);
    await svc.idle();
    assert.deepEqual(calls.map((c) => c.fn), ["registerRecord", "attestSignature", "sealCaseManifest", "logAuditEvent"]);
    const restoredInput = calls[0].args[1] as unknown as Record<string, unknown>;
    assert.equal(restoredInput.parentRecordId, recordIdFor(up.document.id));
    assert.equal(restoredInput.version, 2);
    assert.equal(calls[2].args[1], 2, "manifest version 2: the folder only grows");
    assert.equal(calls[3].args[1], 8, "RESTORE action index");
    assert.equal(r.document.version, 2);
  });

  it("chain disabled (null) → uploads work and nothing is sent", async () => {
    calls.length = 0;
    const r = await uploadDocument(police, { caseId, type: "WITNESS_STATEMENT", filename: "w.txt", mimeType: "text/plain", bytes: Buffer.from(randomBytes(500).toString("hex")) }, { store, chainService: null });
    assert.equal(r.document.version, 1);
    assert.equal(calls.length, 0);
  });
});
