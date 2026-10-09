// SERVER-ONLY. Content-addressed store for encrypted parts. The key IS sha256(object), so an object can never be
// silently replaced: different bytes → different address. Two implementations share one interface:
//   LocalPartStore — a folder on disk (dev / offline demo)       S3PartStore — added with the AWS setup
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { sha256Hex } from "../merkle";
import { S3PartStore } from "./s3-part-store";

export interface PartStore {
  /** Stores bytes under sha256(bytes) and returns that address. Idempotent. */
  put(object: Buffer): Promise<string>;
  /** Returns the object stored at `address`, or null if absent. Does NOT verify the content. */
  get(address: string): Promise<Buffer | null>;
  has(address: string): Promise<boolean>;
  /**
   * The ORIGINAL object first stored under `address`, even if the live object was later overwritten.
   * Local store: a write-once retained copy. S3 (Object Lock + versioning): the locked original version.
   */
  getOriginal(address: string): Promise<Buffer | null>;
  /** DEMO ONLY (insider-attack rehearsal): overwrite the live object at its address. Not part of normal operation. */
  unsafeOverwriteForDemo?(address: string, bytes: Buffer): Promise<void>;
}

const HEX64 = /^[0-9a-f]{64}$/;
const assertAddress = (a: string) => {
  if (!HEX64.test(a)) throw new Error("invalid part address"); // also blocks path traversal
};

export class LocalPartStore implements PartStore {
  constructor(private readonly root: string) {}

  private file(address: string) {
    assertAddress(address);
    return path.join(this.root, address.slice(0, 2), address);
  }

  private retained(address: string) {
    assertAddress(address);
    return path.join(this.root, "_retained", address.slice(0, 2), address);
  }

  async put(object: Buffer): Promise<string> {
    const address = sha256Hex(object);
    const file = this.file(address);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, object, { flag: "w" });
    // write-once retained copy ("wx" refuses to overwrite) — models S3 Object Lock retention
    const keep = this.retained(address);
    await mkdir(path.dirname(keep), { recursive: true });
    await writeFile(keep, object, { flag: "wx" }).catch((e: NodeJS.ErrnoException) => { if (e.code !== "EEXIST") throw e; });
    return address;
  }

  async getOriginal(address: string): Promise<Buffer | null> {
    try {
      const buf = await readFile(this.retained(address));
      return sha256Hex(buf) === address ? buf : null; // a retained copy must itself match its address
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async get(address: string): Promise<Buffer | null> {
    try {
      return await readFile(this.file(address));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async has(address: string): Promise<boolean> {
    try {
      await stat(this.file(address));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * DEMO ONLY — simulates an insider with storage access overwriting a stored object. Real attackers write to the
   * same key; the store's address no longer matches the bytes, which the verifier detects.
   */
  async unsafeOverwriteForDemo(address: string, bytes: Buffer): Promise<void> {
    await writeFile(this.file(address), bytes);
  }
}

let defaultStore: PartStore | undefined;
/** Chooses the backend from env: S3 when S3_EVIDENCE_BUCKET is set (added with AWS setup), otherwise a local folder. */
export function getPartStore(): PartStore {
  if (defaultStore) return defaultStore;
  if (process.env.S3_EVIDENCE_BUCKET) {
    return (defaultStore = new S3PartStore(process.env.S3_EVIDENCE_BUCKET));
  }
  return (defaultStore = new LocalPartStore(process.env.PART_STORE_DIR || path.join(process.cwd(), ".data", "parts")));
}
