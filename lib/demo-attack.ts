// SERVER-ONLY — DEMO / REHEARSAL TOOL. Simulates the insider threat for the tamper-detection demo.
//
// Threat model: an insider who holds the system key AND has write access to the storage bucket decrypts one part, flips ONE
// plaintext byte, re-encrypts it validly (fresh IV, correct GCM tag, same key and AAD) and overwrites the stored object.
// Authenticated decryption still succeeds — which is exactly why integrity needs the hash, chunk-tree and address checks.
// This module never writes plaintext to disk and is only reachable when SAKSHYA_DEMO_ATTACK=1 (see the demo route).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { STORAGE_PART_BYTES } from "@/types/api";
import { systemKeysFromEnv, unwrapDek, type WrappedDek } from "./crypto/pqc";
import { getDb } from "./db";
import { notFound, invalid } from "./errors";
import { getPartStore, type PartStore } from "./storage/part-store";

export interface AttackReport {
  docId: string; offset: number; partIndex: number; flippedByte: { before: number; after: number };
  overwrittenAddress: string; note: string;
}

export function demoAttackEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  // explicit opt-in only (set on the demo server, absent everywhere else); the route is additionally ADMIN-only
  return env.SAKSHYA_DEMO_ATTACK === "1";
}

export async function insiderAttack(docId: string, offset = 9000, store: PartStore = getPartStore()): Promise<AttackReport> {
  if (!demoAttackEnabled() && process.env.SAKSHYA_ALLOW_ATTACK_IN_TESTS !== "1") throw invalid("The demo attack is disabled");
  if (!store.unsafeOverwriteForDemo) throw invalid("This storage backend does not support the overwrite demo");
  const db = await getDb();
  const { row, parts } = await db.withAdmin(async (tx) => {
    const row = (await tx.query("SELECT id, size_bytes, wrapped_dek FROM documents WHERE id = $1", [docId])).rows[0];
    if (!row) throw notFound("Document unavailable");
    const parts = (await tx.query<{ idx: number; address: string }>("SELECT idx, address FROM document_parts WHERE doc_id = $1 ORDER BY idx", [docId])).rows;
    return { row, parts };
  });
  if (offset < 0 || offset >= Number(row.size_bytes)) throw invalid(`offset must be inside the file (0..${Number(row.size_bytes) - 1})`);

  const partIndex = Math.floor(offset / STORAGE_PART_BYTES);
  const within = offset - partIndex * STORAGE_PART_BYTES;
  const part = parts[partIndex];
  const object = await store.get(part.address);
  if (!object) throw notFound("Stored part is missing");

  const dek = unwrapDek(row.wrapped_dek as WrappedDek, systemKeysFromEnv().kem.secretKey);
  try {
    const aad = Buffer.from(`${docId}|${partIndex}|${parts.length}`, "utf8");
    const iv = object.subarray(0, 12), tag = object.subarray(object.length - 16), ct = object.subarray(12, object.length - 16);
    const d = createDecipheriv("aes-256-gcm", dek, iv);
    d.setAAD(aad); d.setAuthTag(tag);
    const plain = Buffer.concat([d.update(ct), d.final()]);
    const before = plain[within];
    plain[within] = before ^ 0x01; // flip exactly one bit of one byte

    const newIv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", dek, newIv);
    c.setAAD(aad);
    const forged = Buffer.concat([newIv, c.update(plain), c.final(), c.getAuthTag()]);
    plain.fill(0);
    await store.unsafeOverwriteForDemo!(part.address, forged); // overwrite the live object at the ORIGINAL address
    return {
      docId, offset, partIndex, flippedByte: { before, after: before ^ 0x01 }, overwrittenAddress: part.address,
      note: "One byte changed and re-encrypted with a valid GCM tag. Decryption still succeeds; hashes, chunk tree and part address expose it.",
    };
  } finally {
    dek.fill(0);
  }
}
