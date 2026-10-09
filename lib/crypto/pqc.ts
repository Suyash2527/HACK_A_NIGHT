// SERVER-ONLY (uses node:crypto + secret keys). Never import from client components.
// Post-quantum layer: ML-KEM-768 key wrapping + ML-DSA-65 signatures (@noble/post-quantum 0.7.1).
// Spike-verified: arg orders sign(msg, sk, opts) / verify(sig, msg, pk, opts); keygen from 64B / 32B seeds.
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

export const ALG = {
  wrap: "ML-KEM-768+HKDF-SHA256+AES-256-GCM",
  sig: "ML-DSA-65",
} as const;

/** FIPS 204 context strings: domain separation so a signature made for one purpose can't be replayed for another. */
export const DSA_CONTEXT = {
  document: new TextEncoder().encode("sakshya/doc-sig/v1"),
  batch: new TextEncoder().encode("sakshya/batch-sig/v1"),
  audit: new TextEncoder().encode("sakshya/audit-sig/v1"),
} as const;
export type SigPurpose = keyof typeof DSA_CONTEXT;

const HKDF_INFO = "sakshya/dek-wrap/v1";
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

// ───────────────────────── keys
export interface KeyPair { publicKey: Uint8Array; secretKey: Uint8Array }
export interface SystemKeys { kem: KeyPair; dsa: KeyPair }

/** One-off helper: base64 seeds for PQC_KEM_SEED (64 B → 88 chars) and PQC_DSA_SEED (32 B → 44 chars). */
export function generateSeeds(): { kemSeed: string; dsaSeed: string } {
  return { kemSeed: randomBytes(64).toString("base64"), dsaSeed: randomBytes(32).toString("base64") };
}

export function deriveSystemKeys(seeds: { kemSeed: string | Uint8Array; dsaSeed: string | Uint8Array }): SystemKeys {
  const kemSeed = typeof seeds.kemSeed === "string" ? unb64(seeds.kemSeed) : seeds.kemSeed;
  const dsaSeed = typeof seeds.dsaSeed === "string" ? unb64(seeds.dsaSeed) : seeds.dsaSeed;
  if (kemSeed.length !== 64) throw new Error(`kemSeed must be 64 bytes, got ${kemSeed.length}`);
  if (dsaSeed.length !== 32) throw new Error(`dsaSeed must be 32 bytes, got ${dsaSeed.length}`);
  return { kem: ml_kem768.keygen(kemSeed), dsa: ml_dsa65.keygen(dsaSeed) };
}

let cachedSystemKeys: SystemKeys | undefined;
/** Cached per process; keygen is ~1–7 ms. Throws if the seeds are not configured. */
export function systemKeysFromEnv(): SystemKeys {
  const kemSeed = process.env.PQC_KEM_SEED;
  const dsaSeed = process.env.PQC_DSA_SEED;
  if (!kemSeed || !dsaSeed) throw new Error("PQC_KEM_SEED / PQC_DSA_SEED are not set (see .env.example)");
  return (cachedSystemKeys ??= deriveSystemKeys({ kemSeed, dsaSeed }));
}

/** Per-user ML-DSA-65 key derived from the system DSA seed: HKDF(seed, salt=userId). Custodial — disclose this. */
export function deriveUserDsaKeys(systemDsaSeed: string | Uint8Array, userId: string): KeyPair {
  const seed = typeof systemDsaSeed === "string" ? unb64(systemDsaSeed) : systemDsaSeed;
  const derived = new Uint8Array(hkdfSync("sha256", seed, Buffer.from(userId, "utf8"), "sakshya/user-dsa/v1", 32));
  return ml_dsa65.keygen(derived);
}

// ───────────────────────── DEK wrapping (ML-KEM-768 → HKDF-SHA256 → AES-256-GCM)
export interface WrappedDek {
  alg: typeof ALG.wrap;
  kemCt: string; // base64 ML-KEM ciphertext (1088 B)
  salt: string; // base64 HKDF salt
  iv: string;
  tag: string;
  wrapped: string; // base64 AES-GCM(DEK)
}

const kek = (sharedSecret: Uint8Array, salt: Uint8Array) =>
  Buffer.from(hkdfSync("sha256", sharedSecret, salt, HKDF_INFO, 32));

export function wrapDek(dek: Uint8Array, kemPublicKey: Uint8Array): WrappedDek {
  if (dek.length !== 32) throw new Error("DEK must be 32 bytes");
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(kemPublicKey);
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", kek(sharedSecret, salt), iv);
  cipher.setAAD(cipherText); // bind the wrapped DEK to its KEM ciphertext
  const wrapped = Buffer.concat([cipher.update(dek), cipher.final()]);
  sharedSecret.fill(0);
  return { alg: ALG.wrap, kemCt: b64(cipherText), salt: b64(salt), iv: b64(iv), tag: b64(cipher.getAuthTag()), wrapped: b64(wrapped) };
}

/** ML-KEM decapsulation never throws on a bad ciphertext (implicit rejection); the AES-GCM check below does. */
export function unwrapDek(w: WrappedDek, kemSecretKey: Uint8Array): Buffer {
  const kemCt = unb64(w.kemCt);
  const sharedSecret = ml_kem768.decapsulate(kemCt, kemSecretKey);
  const decipher = createDecipheriv("aes-256-gcm", kek(sharedSecret, unb64(w.salt)), unb64(w.iv));
  decipher.setAAD(kemCt);
  decipher.setAuthTag(unb64(w.tag));
  try {
    return Buffer.concat([decipher.update(unb64(w.wrapped)), decipher.final()]);
  } finally {
    sharedSecret.fill(0);
  }
}

// ───────────────────────── canonical JSON + ML-DSA-65
/** Deterministic JSON: recursively sorted keys, no whitespace. Rejects undefined / NaN / non-plain objects. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("non-finite number in canonicalJson");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => {
        if (o[k] === undefined) throw new Error(`undefined at key "${k}" in canonicalJson`);
        return `${JSON.stringify(k)}:${canonicalJson(o[k])}`;
      })
      .join(",")}}`;
  }
  throw new Error(`unsupported type in canonicalJson: ${typeof v}`);
}

/** Signed by the uploader. All hashes are plain lowercase hex (no 0x). */
export interface DocPayload {
  docId: string;
  caseId: string;
  docType: string;
  version: number;
  sha256: string;
  chunkRoot: string;
  partRoot: string; // merkle root over the stored part addresses
  timestamp: string; // ISO-8601 string
}

export interface SignedPayload { alg: typeof ALG.sig; canonical: string; signature: string }

export function signCanonical(value: unknown, secretKey: Uint8Array, purpose: SigPurpose): SignedPayload {
  const canonical = canonicalJson(value);
  const sig = ml_dsa65.sign(new TextEncoder().encode(canonical), secretKey, { context: DSA_CONTEXT[purpose] });
  return { alg: ALG.sig, canonical, signature: b64(sig) };
}

/** Verifies against a canonical string (the exact bytes that were signed). Malformed input → false. */
export function verifyCanonical(canonical: string, signatureB64: string, publicKey: Uint8Array, purpose: SigPurpose): boolean {
  try {
    return ml_dsa65.verify(unb64(signatureB64), new TextEncoder().encode(canonical), publicKey, { context: DSA_CONTEXT[purpose] });
  } catch {
    return false;
  }
}

export const signDocument = (p: DocPayload, sk: Uint8Array) => signCanonical(p, sk, "document");
export const verifyDocument = (p: DocPayload, sig: string, pk: Uint8Array) =>
  verifyCanonical(canonicalJson(p), sig, pk, "document");
