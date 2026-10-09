// Merkle integrity layer (server-side; node:crypto). merkletreejs 0.6.0 with SHA-256, { sortPairs: true } only.
// CONVENTION: every hash returned here is plain lowercase hex (64 chars, NO 0x) — matching types/api.ts `Hash`.
// Use toChainHex() ONLY at the blockchain boundary (bytes32 for the registry contract).
// Spike-verified: leaf hashing is done by us (hashLeaves:false); odd nodes are promoted (duplicateOdd:false).
import { createHash } from "node:crypto";
import { MerkleTree } from "merkletreejs";
import { MERKLE_CHUNK_BYTES } from "@/types/api";
import type { TamperRange } from "@/types/api";

export const CHUNK_SIZE = MERKLE_CHUNK_BYTES;
const TREE_OPTS = { sortPairs: true } as const;
const DOC_LEAF_TAG = Buffer.from("QS:doc-leaf:v1", "utf8"); // domain separation: leaf ≠ internal node preimage
const PART_TAG = Buffer.from("QS:part-root:v1", "utf8");

export const sha256 = (data: Uint8Array): Buffer => createHash("sha256").update(data).digest();
export const sha256Hex = (data: Uint8Array): string => sha256(data).toString("hex");

const HEX64 = /^[0-9a-f]{64}$/;
/** Accepts plain or 0x-prefixed hex, returns plain lowercase 64-char hex, throws otherwise. */
export function normalizeHash(h: string): string {
  const s = h.toLowerCase().replace(/^0x/, "");
  if (!HEX64.test(s)) throw new Error(`expected 32-byte hex hash, got "${h.slice(0, 20)}…"`);
  return s;
}
/** 0x-prefixed bytes32 for ethers/Solidity — blockchain boundary only. */
export const toChainHex = (h: string): `0x${string}` => `0x${normalizeHash(h)}`;
const buf = (h: string) => Buffer.from(normalizeHash(h), "hex");

// ───────────────────────── per-document chunk tree (tamper localisation)
/** leaf_i = sha256(chunk_i). Empty input → one leaf = sha256("") so the root is always defined. */
export function chunkLeaves(data: Uint8Array, chunkSize = CHUNK_SIZE): string[] {
  if (data.length === 0) return [sha256Hex(new Uint8Array(0))];
  const out: string[] = [];
  for (let off = 0; off < data.length; off += chunkSize) out.push(sha256Hex(data.subarray(off, off + chunkSize)));
  return out;
}

export interface ChunkTree {
  root: string;
  leaves: string[];
  chunkSize: number;
  size: number;
  fileSha256: string;
}

export function buildChunkTree(data: Uint8Array, chunkSize = CHUNK_SIZE): ChunkTree {
  const leaves = chunkLeaves(data, chunkSize);
  const tree = new MerkleTree(leaves.map(buf), sha256, TREE_OPTS);
  return { root: tree.getRoot().toString("hex"), leaves, chunkSize, size: data.length, fileSha256: sha256Hex(data) };
}

/** Diff stored leaves vs current bytes. [] ⇒ intact. Indices zero-based, byteEnd inclusive. */
export function localizeTamper(
  storedLeaves: string[],
  current: Uint8Array,
  chunkSize = CHUNK_SIZE,
  storedSize?: number,
): TamperRange[] {
  const stored = storedLeaves.map(normalizeHash);
  const now = chunkLeaves(current, chunkSize);
  const total = Math.max(current.length, storedSize ?? stored.length * chunkSize);
  const out: TamperRange[] = [];
  for (let i = 0; i < Math.max(stored.length, now.length); i++) {
    if (stored[i] === now[i]) continue;
    const byteStart = i * chunkSize;
    out.push({
      chunkIndex: i,
      byteStart,
      byteEnd: Math.max(byteStart, Math.min((i + 1) * chunkSize, total) - 1),
      kind: i >= stored.length ? "added" : i >= now.length ? "removed" : "modified",
    });
  }
  return out;
}

// ───────────────────────── stored-part root (content-addressed parts of one document)
/** Root over the ordered part addresses; binds the exact set + order of stored ciphertext objects. */
export function partRoot(addresses: string[]): string {
  if (addresses.length === 0) throw new Error("document has no parts");
  const tree = new MerkleTree(addresses.map((a) => sha256(Buffer.concat([PART_TAG, buf(a)]))), sha256, { sortPairs: false });
  return tree.getRoot().toString("hex");
}

// ───────────────────────── batch / case-manifest trees
/** Leaf = sha256(tag ‖ docId(16 B) ‖ fileSha256 ‖ chunkRoot ‖ partRoot). Binds identity, content, chunks and stored parts. */
export function docLeaf(docId: string, fileSha256: string, chunkRootHex: string, partRootHex: string): string {
  const id = Buffer.from(docId.replace(/-/g, ""), "hex");
  if (id.length !== 16) throw new Error("docId must be a UUID");
  return sha256Hex(Buffer.concat([DOC_LEAF_TAG, id, buf(fileSha256), buf(chunkRootHex), buf(partRootHex)]));
}

export interface LeafTree { tree: MerkleTree; root: string; leaves: string[] }

/** Leaves keep insertion order (index == position). Needs ≥1 leaf; a single leaf's root equals the leaf. */
export function buildTree(leaves: string[]): LeafTree {
  if (leaves.length === 0) throw new Error("empty tree");
  const norm = leaves.map(normalizeHash);
  const tree = new MerkleTree(norm.map(buf), sha256, TREE_OPTS);
  return { tree, root: tree.getRoot().toString("hex"), leaves: norm };
}

/** jsonb-ready proof record. */
export interface StoredProof { v: 1; alg: "sha256-sorted"; root: string; leaf: string; index: number; proof: string[] }

export function getProof(t: LeafTree, index: number): StoredProof {
  if (!Number.isInteger(index) || index < 0 || index >= t.leaves.length) throw new Error(`bad leaf index ${index}`);
  const leaf = t.leaves[index];
  // always pass the index: merkletreejs silently returns [] for unknown leaves
  const proof = t.tree.getProof(buf(leaf), index).map((p) => p.data.toString("hex"));
  return { v: 1, alg: "sha256-sorted", root: t.root, leaf, index, proof };
}

/** Library-free verifier (sorted-pair sha256); same algorithm a Solidity verifier would use. */
export function verifyProof(proof: string[], leaf: string, root: string): boolean {
  let h: Buffer = buf(leaf);
  for (const p of proof) {
    const s = buf(p);
    h = Buffer.compare(h, s) <= 0 ? sha256(Buffer.concat([h, s])) : sha256(Buffer.concat([s, h]));
  }
  return h.equals(buf(root));
}

/** Case "folder" manifest root over every document leaf in the case (leaf order = upload order). */
export const buildManifest = (docLeaves: string[]) => buildTree(docLeaves);
