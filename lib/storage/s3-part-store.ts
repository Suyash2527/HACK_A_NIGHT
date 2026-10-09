// SERVER-ONLY. Evidence parts in Amazon S3: private bucket, SSE-KMS, versioning + Object Lock (GOVERNANCE).
// Key = `parts/<sha256(object)>`. Content-addressed, so identical bytes are never re-written; an overwrite of a live key
// (the insider attack) creates a NEW version, while Object Lock keeps the ORIGINAL version undeletable — that is `getOriginal`.
import {
  GetObjectCommand, HeadObjectCommand, ListObjectVersionsCommand, PutObjectCommand, S3Client, type ObjectVersion,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { sha256Hex } from "../merkle";
import type { PartStore } from "./part-store";

const HEX64 = /^[0-9a-f]{64}$/;
const keyOf = (address: string) => {
  if (!HEX64.test(address)) throw new Error("invalid part address");
  return `parts/${address}`;
};

export class S3PartStore implements PartStore {
  constructor(private readonly bucket: string, private readonly client = new S3Client({ region: process.env.AWS_REGION || "ap-south-1" })) {}

  async put(object: Buffer): Promise<string> {
    const address = sha256Hex(object);
    if (!(await this.has(address)))
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: keyOf(address), Body: object, ContentType: "application/octet-stream", ChecksumSHA256: sha256Base64(object) }));
    return address;
  }

  async get(address: string): Promise<Buffer | null> {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: keyOf(address) }));
      return Buffer.from(await out.Body!.transformToByteArray());
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  async has(address: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: keyOf(address) }));
      return true;
    } catch (e) {
      if (isNotFound(e)) return false;
      throw e;
    }
  }

  /** The oldest stored version whose bytes still hash to the address. A locked version cannot be removed or altered. */
  async getOriginal(address: string): Promise<Buffer | null> {
    const key = keyOf(address);
    const listed = await this.client.send(new ListObjectVersionsCommand({ Bucket: this.bucket, Prefix: key }));
    const versions = (listed.Versions ?? []).filter((v): v is ObjectVersion & { VersionId: string } => v.Key === key && !!v.VersionId)
      .sort((a, b) => (a.LastModified?.getTime() ?? 0) - (b.LastModified?.getTime() ?? 0));
    for (const v of versions) {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, VersionId: v.VersionId }));
      const bytes = Buffer.from(await out.Body!.transformToByteArray());
      if (sha256Hex(bytes) === address) return bytes;
    }
    return null;
  }

  /** DEMO ONLY: writes a new version at the same key (what a malicious insider with bucket write access could do). */
  async unsafeOverwriteForDemo(address: string, bytes: Buffer): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: keyOf(address), Body: bytes, ContentType: "application/octet-stream" }));
  }
}

const sha256Base64 = (b: Buffer) => createHash("sha256").update(b).digest("base64");
const isNotFound = (e: unknown) => {
  const x = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return x?.name === "NoSuchKey" || x?.name === "NotFound" || x?.$metadata?.httpStatusCode === 404;
};
