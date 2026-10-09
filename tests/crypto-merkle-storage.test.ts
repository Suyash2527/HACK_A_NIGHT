import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { openDocument, sealDocument } from "../lib/crypto/parts";
import {
  canonicalJson, deriveSystemKeys, deriveUserDsaKeys, generateSeeds, signDocument, unwrapDek, verifyDocument, wrapDek,
  type DocPayload,
} from "../lib/crypto/pqc";
import {
  buildChunkTree, buildManifest, buildTree, docLeaf, getProof, localizeTamper, partRoot, sha256Hex, toChainHex, verifyProof,
} from "../lib/merkle";
import { LocalPartStore } from "../lib/storage/part-store";

const seeds = generateSeeds();
const keys = deriveSystemKeys(seeds);
const bytes = (n: number) => new Uint8Array(randomBytes(n));

describe("post-quantum keys & signatures", () => {
  it("regenerates identical keys from the short seeds", () => {
    const again = deriveSystemKeys(seeds);
    assert.deepEqual(again.kem.publicKey, keys.kem.publicKey);
    assert.deepEqual(again.dsa.publicKey, keys.dsa.publicKey);
    assert.equal(seeds.kemSeed.length, 88);
    assert.equal(seeds.dsaSeed.length, 44);
  });

  it("rejects wrong-length seeds", () => {
    assert.throws(() => deriveSystemKeys({ kemSeed: new Uint8Array(32), dsaSeed: new Uint8Array(32) }), /kemSeed/);
    assert.throws(() => deriveSystemKeys({ kemSeed: new Uint8Array(64), dsaSeed: new Uint8Array(64) }), /dsaSeed/);
  });

  const payload: DocPayload = {
    docId: randomUUID(), caseId: randomUUID(), docType: "FIR", version: 1,
    sha256: "a".repeat(64), chunkRoot: "b".repeat(64), partRoot: "c".repeat(64), timestamp: "2026-10-10T05:00:00.000Z",
  };

  it("signs and verifies a document payload; any change breaks it", () => {
    const user = deriveUserDsaKeys(seeds.dsaSeed, "user-1");
    const { signature, canonical } = signDocument(payload, user.secretKey);
    assert.equal(canonical, canonicalJson(payload));
    assert.equal(verifyDocument(payload, signature, user.publicKey), true);
    assert.equal(verifyDocument({ ...payload, version: 2 }, signature, user.publicKey), false);
    assert.equal(verifyDocument({ ...payload, sha256: "d".repeat(64) }, signature, user.publicKey), false);
    assert.equal(verifyDocument(payload, signature, deriveUserDsaKeys(seeds.dsaSeed, "user-2").publicKey), false);
    assert.equal(verifyDocument(payload, "not-a-signature", user.publicKey), false);
  });

  it("canonical JSON ignores key order and rejects undefined", () => {
    assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
    assert.throws(() => canonicalJson({ a: undefined }), /undefined/);
  });

  it("a signature for one purpose does not verify for another (context separation)", async () => {
    const { signCanonical, verifyCanonical } = await import("../lib/crypto/pqc");
    const s = signCanonical({ x: 1 }, keys.dsa.secretKey, "document");
    assert.equal(verifyCanonical(s.canonical, s.signature, keys.dsa.publicKey, "document"), true);
    assert.equal(verifyCanonical(s.canonical, s.signature, keys.dsa.publicKey, "batch"), false);
  });
});

describe("ML-KEM-768 DEK wrapping", () => {
  it("round-trips, and a tampered wrapped key throws", () => {
    const dek = randomBytes(32);
    const w = wrapDek(dek, keys.kem.publicKey);
    assert.deepEqual(unwrapDek(w, keys.kem.secretKey), dek);
    const bad = { ...w, wrapped: Buffer.from(Buffer.from(w.wrapped, "base64").map((b, i) => (i === 0 ? b ^ 1 : b))).toString("base64") };
    assert.throws(() => unwrapDek(bad, keys.kem.secretKey));
    const otherKeys = deriveSystemKeys(generateSeeds());
    assert.throws(() => unwrapDek(w, otherKeys.kem.secretKey));
  });
});

describe("sharded, content-addressed documents", () => {
  const docId = randomUUID();
  const plain = bytes(200_000); // 4 parts of 64 KiB (last partial)
  const sealed = sealDocument(plain, keys.kem.publicKey, docId);
  const addresses = sealed.parts.map((p) => p.address);
  const objects = () => sealed.parts.map((p) => Buffer.from(p.object));

  it("splits into 64 KiB parts, each addressed by its own hash", () => {
    assert.equal(sealed.parts.length, 4);
    assert.equal(sealed.parts[3].plainSize, 200_000 - 3 * 65_536);
    for (const p of sealed.parts) assert.equal(sha256Hex(p.object), p.address);
    assert.equal(sealed.sha256, sha256Hex(plain));
    assert.equal(sealed.partRoot, partRoot(addresses));
    assert.equal(sealed.parts.some((p) => p.object.includes(Buffer.from(plain.subarray(0, 32)))), false, "no plaintext in stored objects");
  });

  it("reassembles the exact original bytes", () => {
    const opened = openDocument(objects(), addresses, sealed.wrappedDek, keys.kem.secretKey, docId);
    assert.equal(opened.allPartsOk, true);
    assert.deepEqual(opened.plaintext, Buffer.from(plain));
  });

  it("handles empty and tiny files", () => {
    for (const n of [0, 1, 65_536, 65_537]) {
      const s = sealDocument(bytes(n), keys.kem.publicKey, docId);
      const o = openDocument(s.parts.map((p) => p.object), s.parts.map((p) => p.address), s.wrappedDek, keys.kem.secretKey, docId);
      assert.equal(o.allPartsOk, true);
      assert.equal(o.plaintext!.length, n);
    }
  });

  it("flipped ciphertext byte → that part reports address-mismatch (no decryption needed)", () => {
    const objs = objects();
    objs[2][100] ^= 1;
    const o = openDocument(objs, addresses, sealed.wrappedDek, keys.kem.secretKey, docId);
    assert.deepEqual(o.parts.map((p) => p.state), ["ok", "ok", "address-mismatch", "ok"]);
    assert.equal(o.plaintext, null);
    assert.equal(o.diagnosticPlaintext, null, "a corrupted ciphertext cannot be decrypted at all");
  });

  it("a part swapped for another valid part fails authentication (AAD binds position)", () => {
    const objs = objects();
    [objs[0], objs[1]] = [objs[1], objs[0]];
    const swappedAddresses = [addresses[1], addresses[0], addresses[2], addresses[3]];
    const o = openDocument(objs, swappedAddresses, sealed.wrappedDek, keys.kem.secretKey, docId);
    assert.equal(o.parts[0].state, "auth-failed");
    assert.equal(o.parts[1].state, "auth-failed");
  });

  it("a part copied from another document fails authentication (AAD binds docId)", () => {
    const other = sealDocument(plain, keys.kem.publicKey, randomUUID());
    const o = openDocument(other.parts.map((p) => p.object), other.parts.map((p) => p.address), other.wrappedDek, keys.kem.secretKey, docId);
    assert.equal(o.allPartsOk, false);
    assert.ok(o.parts.every((p) => p.state === "auth-failed"));
  });

  it("missing parts and a wrong system key are reported, not thrown", () => {
    const objs: (Buffer | null)[] = objects();
    objs[1] = null;
    assert.equal(openDocument(objs, addresses, sealed.wrappedDek, keys.kem.secretKey, docId).parts[1].state, "missing");
    const wrongKey = deriveSystemKeys(generateSeeds());
    const o = openDocument(objects(), addresses, sealed.wrappedDek, wrongKey.kem.secretKey, docId);
    assert.ok(o.parts.every((p) => p.state === "auth-failed"));
  });

  it("INSIDER SCENARIO: key holder edits ONE plaintext byte, re-seals → GCM passes, Merkle pinpoints the chunk", () => {
    const original = bytes(50 * 1024);
    const tree = buildChunkTree(original);
    const attack = new Uint8Array(original);
    attack[9000] ^= 0x01; // the demo byte
    // attacker decrypts, edits, re-encrypts with valid GCM for the same doc/position
    const resealed = sealDocument(attack, keys.kem.publicKey, docId);
    const o = openDocument(resealed.parts.map((p) => p.object), resealed.parts.map((p) => p.address), resealed.wrappedDek, keys.kem.secretKey, docId);
    assert.equal(o.allPartsOk, true, "decryption alone cannot see this attack");
    assert.notEqual(sha256Hex(o.plaintext!), tree.fileSha256);
    assert.deepEqual(localizeTamper(tree.leaves, o.plaintext!, tree.chunkSize, tree.size), [
      { chunkIndex: 2, byteStart: 8192, byteEnd: 12287, kind: "modified" },
    ]);
    assert.notEqual(resealed.partRoot, sealed.partRoot);
  });
});

describe("merkle trees", () => {
  it("chunk tree: intact → no ranges; one byte at 9000 → chunk 2 [8192,12287]", () => {
    const data = bytes(51_200);
    const t = buildChunkTree(data);
    assert.equal(t.leaves.length, 13);
    assert.deepEqual(localizeTamper(t.leaves, data, 4096, t.size), []);
    const bad = new Uint8Array(data);
    bad[9000] ^= 1;
    assert.deepEqual(localizeTamper(t.leaves, bad, 4096, t.size), [{ chunkIndex: 2, byteStart: 8192, byteEnd: 12287, kind: "modified" }]);
  });

  it("detects truncation and appended data", () => {
    const data = bytes(51_200);
    const t = buildChunkTree(data);
    assert.deepEqual(localizeTamper(t.leaves, data.subarray(0, 51_100), 4096, t.size), [{ chunkIndex: 12, byteStart: 49_152, byteEnd: 51_199, kind: "modified" }]);
    const longer = new Uint8Array(51_200 + 5000);
    longer.set(data);
    const r = localizeTamper(t.leaves, longer, 4096, t.size);
    assert.equal(r.at(-1)?.kind, "added");
  });

  it("empty and single-chunk files have defined roots", () => {
    assert.equal(buildChunkTree(new Uint8Array(0)).leaves[0], sha256Hex(new Uint8Array(0)));
    const one = buildChunkTree(bytes(100));
    assert.equal(one.root, one.leaves[0]);
  });

  it("batch / manifest proofs verify for every leaf and size, and fail for a forged leaf", () => {
    for (const n of [1, 2, 3, 5, 7, 16, 17, 100]) {
      const leaves = Array.from({ length: n }, (_, i) => docLeaf(randomUUID(), sha256Hex(Buffer.from(`f${i}`)), sha256Hex(Buffer.from(`c${i}`)), sha256Hex(Buffer.from(`p${i}`))));
      const t = buildManifest(leaves);
      for (let i = 0; i < n; i++) {
        const row = getProof(t, i);
        assert.equal(verifyProof(row.proof, leaves[i], t.root), true, `n=${n} i=${i}`);
        assert.equal(verifyProof(JSON.parse(JSON.stringify(row)).proof, leaves[i], t.root), true);
        assert.equal(verifyProof(row.proof, sha256Hex(Buffer.from("forged")), t.root), false);
      }
    }
  });

  it("docLeaf binds identity: same file under a different docId gives a different leaf", () => {
    const f = sha256Hex(Buffer.from("same")), c = sha256Hex(Buffer.from("c")), p = sha256Hex(Buffer.from("p"));
    assert.notEqual(docLeaf(randomUUID(), f, c, p), docLeaf(randomUUID(), f, c, p));
    assert.throws(() => docLeaf("not-a-uuid", f, c, p));
  });

  it("hash helpers: plain hex in the app, 0x only at the chain boundary", () => {
    const h = sha256Hex(Buffer.from("x"));
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.equal(toChainHex(h), `0x${h}`);
    assert.equal(toChainHex(`0x${h}`), `0x${h}`);
    assert.throws(() => toChainHex("0x1234"));
    assert.throws(() => buildTree([]));
  });
});

describe("content-addressed part store (local)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "qs-parts-"));
  after(() => rm(dir, { recursive: true, force: true }));
  const store = new LocalPartStore(dir);

  it("put returns sha256 of the bytes; get returns them; unknown address → null", async () => {
    const obj = Buffer.from(randomBytes(500));
    const address = await store.put(obj);
    assert.equal(address, sha256Hex(obj));
    assert.deepEqual(await store.get(address), obj);
    assert.equal(await store.has(address), true);
    assert.equal(await store.get("0".repeat(64)), null);
    assert.equal(await store.put(obj), address, "idempotent");
  });

  it("rejects path-traversal style addresses", async () => {
    await assert.rejects(() => store.get("../../etc/passwd"), /invalid part address/);
    await assert.rejects(() => store.get("a".repeat(63)), /invalid part address/);
  });

  it("end to end: seal → store → insider overwrites a stored part → verifier names that part", async () => {
    const docId = randomUUID();
    const sealed = sealDocument(bytes(150_000), keys.kem.publicKey, docId);
    const addresses = await Promise.all(sealed.parts.map((p) => store.put(p.object)));
    assert.deepEqual(addresses, sealed.parts.map((p) => p.address));

    const clean = openDocument(await Promise.all(addresses.map((a) => store.get(a))), addresses, sealed.wrappedDek, keys.kem.secretKey, docId);
    assert.equal(clean.allPartsOk, true);

    const victim = Buffer.from((await store.get(addresses[1]))!);
    victim[500] ^= 0xff;
    await store.unsafeOverwriteForDemo(addresses[1], victim);

    const hit = openDocument(await Promise.all(addresses.map((a) => store.get(a))), addresses, sealed.wrappedDek, keys.kem.secretKey, docId);
    assert.deepEqual(hit.parts.map((p) => p.state), ["ok", "address-mismatch", "ok"]);
  });
});

describe("retained originals (stand-in for S3 Object Lock)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "qs-ret-"));
  after(() => rm(dir, { recursive: true, force: true }));
  const store = new LocalPartStore(dir);
  it("the original survives a later overwrite of the live object", async () => {
    const obj = Buffer.from(randomBytes(300));
    const address = await store.put(obj);
    await store.unsafeOverwriteForDemo(address, Buffer.from(randomBytes(300)));
    assert.notDeepEqual(await store.get(address), obj);
    assert.deepEqual(await store.getOriginal(address), obj);
    await store.put(Buffer.from(randomBytes(10)));
    assert.equal(await store.getOriginal("f".repeat(64)), null);
  });
});
