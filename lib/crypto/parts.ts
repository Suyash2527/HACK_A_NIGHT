// SERVER-ONLY. Splits a document into independently encrypted, content-addressed parts.
//
//   plaintext ──split 64 KiB──► part_i ──AES-256-GCM(DEK, iv_i, AAD=docId|i|count)──► object_i = iv ‖ ciphertext ‖ tag
//   address_i = sha256(object_i)  (the storage key)   ·   DEK is wrapped once per document (ML-KEM-768)
//
// Why: (1) any edit to a stored part changes its bytes, so it no longer matches its address → "part N altered"
// is detected WITHOUT decrypting; (2) the AAD binds each part to its document, position and total count, so parts
// cannot be swapped, reordered, dropped or replayed across documents; (3) the court bundle is assembled by
// fetching every address, verifying it, then decrypting and concatenating.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { STORAGE_PART_BYTES } from "@/types/api";
import { partRoot, sha256Hex } from "../merkle";
import { unwrapDek, wrapDek, type WrappedDek } from "./pqc";

const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface SealedPart {
  index: number;
  address: string; // sha256(object) — plain hex
  object: Buffer; // iv ‖ ciphertext ‖ tag  — this is what gets stored
  plainSize: number;
}

export interface SealedDocument {
  parts: SealedPart[];
  wrappedDek: WrappedDek;
  sha256: string; // whole-plaintext hash
  partRoot: string; // Merkle root over ordered part addresses
  size: number;
}

const aadFor = (docId: string, index: number, count: number) => Buffer.from(`${docId}|${index}|${count}`, "utf8");

export function sealDocument(plaintext: Uint8Array, kemPublicKey: Uint8Array, docId: string, partSize = STORAGE_PART_BYTES): SealedDocument {
  const dek = randomBytes(32);
  try {
    const count = Math.max(1, Math.ceil(plaintext.length / partSize));
    const parts: SealedPart[] = [];
    for (let i = 0; i < count; i++) {
      const slice = plaintext.subarray(i * partSize, (i + 1) * partSize);
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", dek, iv);
      cipher.setAAD(aadFor(docId, i, count));
      const ct = Buffer.concat([cipher.update(slice), cipher.final()]);
      const object = Buffer.concat([iv, ct, cipher.getAuthTag()]);
      parts.push({ index: i, address: sha256Hex(object), object, plainSize: slice.length });
    }
    return {
      parts,
      wrappedDek: wrapDek(dek, kemPublicKey),
      sha256: sha256Hex(plaintext),
      partRoot: partRoot(parts.map((p) => p.address)),
      size: plaintext.length,
    };
  } finally {
    dek.fill(0);
  }
}

export type PartState = "ok" | "missing" | "address-mismatch" | "auth-failed";

export interface OpenedPart {
  index: number;
  address: string;
  state: PartState;
  plaintext: Buffer | null;
}

export interface OpenedDocument {
  parts: OpenedPart[];
  /** Concatenated plaintext of ALL parts, or null if any part is unusable. */
  plaintext: Buffer | null;
  /**
   * Best-effort plaintext for DIAGNOSIS ONLY: parts whose bytes no longer match their address are still decrypted when
   * their GCM tag authenticates (an insider with the key re-encrypts validly). Lets the verifier localise the changed
   * chunk. NEVER serve this to users — only `plaintext` (all parts clean) is releasable.
   */
  diagnosticPlaintext: Buffer | null;
  /** True when every part is present, matches its address and authenticates. */
  allPartsOk: boolean;
}

/**
 * Opens a document from its stored objects. `fetched[i]` is the object found at addresses[i] (null if missing).
 * Never throws for tampering — returns per-part states so the verifier can show exactly which part failed.
 */
export function openDocument(
  fetched: (Buffer | null)[],
  addresses: string[],
  wrappedDek: WrappedDek,
  kemSecretKey: Uint8Array,
  docId: string,
): OpenedDocument {
  const count = addresses.length;
  let dek: Buffer | null = null;
  try {
    dek = unwrapDek(wrappedDek, kemSecretKey);
  } catch {
    // key unwrap failed: every part is unreadable, but address checks still tell us what changed
  }

  const parts: OpenedPart[] = addresses.map((address, index) => {
    const object = fetched[index];
    if (!object) return { index, address, state: "missing", plaintext: null };
    const addressOk = sha256Hex(object) === address;
    if (!dek || object.length < IV_BYTES + TAG_BYTES) return { index, address, state: addressOk ? "auth-failed" : "address-mismatch", plaintext: null };
    try {
      const iv = object.subarray(0, IV_BYTES);
      const tag = object.subarray(object.length - TAG_BYTES);
      const ct = object.subarray(IV_BYTES, object.length - TAG_BYTES);
      const decipher = createDecipheriv("aes-256-gcm", dek, iv);
      decipher.setAAD(aadFor(docId, index, count));
      decipher.setAuthTag(tag);
      return { index, address, state: addressOk ? "ok" : "address-mismatch", plaintext: Buffer.concat([decipher.update(ct), decipher.final()]) };
    } catch {
      return { index, address, state: addressOk ? "auth-failed" : "address-mismatch", plaintext: null };
    }
  });
  dek?.fill(0);

  const allPartsOk = parts.every((p) => p.state === "ok");
  const decryptable = parts.every((p) => p.plaintext !== null);
  return {
    parts,
    plaintext: allPartsOk ? Buffer.concat(parts.map((p) => p.plaintext!)) : null,
    diagnosticPlaintext: decryptable ? Buffer.concat(parts.map((p) => p.plaintext!)) : null,
    allPartsOk,
  };
}
