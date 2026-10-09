// SERVER-ONLY short-lived holder for assembled court bundles. "No plaintext at rest": a bundle lives ONLY in this process's memory,
// is bound to the user who assembled it, and disappears after BUNDLE_TTL_MS (or sooner when memory pressure evicts it).
import { randomBytes } from "node:crypto";

export const BUNDLE_TTL_MS = 10 * 60 * 1000;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;

export interface StoredBundle { userId: string; caseId: string; bytes: Buffer; sha256: string; filename: string; expiresAt: number; docIds: string[] }
const bundles = new Map<string, StoredBundle>();

function sweep(now = Date.now()) {
  for (const [t, b] of bundles) if (b.expiresAt <= now) bundles.delete(t);
  let total = [...bundles.values()].reduce((n, b) => n + b.bytes.length, 0);
  for (const [t, b] of bundles) { if (total <= MAX_TOTAL_BYTES) break; bundles.delete(t); total -= b.bytes.length; } // oldest first
}

export function putBundle(b: Omit<StoredBundle, "expiresAt">, now = Date.now()): { token: string; expiresAt: number } {
  sweep(now);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = now + BUNDLE_TTL_MS;
  bundles.set(token, { ...b, expiresAt });
  return { token, expiresAt };
}

/** Returns the bundle only for the user and case it was made for, before it expires. */
export function getBundle(token: string, userId: string, caseId: string, now = Date.now()): StoredBundle | null {
  sweep(now);
  const b = bundles.get(token);
  return b && b.userId === userId && b.caseId === caseId ? b : null;
}

export function clearBundlesForTests() { bundles.clear(); }
