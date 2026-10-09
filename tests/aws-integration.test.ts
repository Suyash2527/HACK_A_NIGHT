// REAL AWS integration checks (opt-in): SAKSHYA_AWS_TESTS=1 npm run test:aws
// Uses the account configured by `aws configure` + .env.local. Creates a few tiny objects (locked for 1 day by design).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { before, describe, it } from "node:test";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const enabled = process.env.SAKSHYA_AWS_TESTS === "1";
const bucket = process.env.S3_EVIDENCE_BUCKET;

describe("AWS: S3 evidence store (Object Lock + versioning)", { skip: !enabled || !bucket }, () => {
  let store: import("../lib/storage/s3-part-store").S3PartStore;
  before(async () => { const m = await import("../lib/storage/s3-part-store"); store = new m.S3PartStore(bucket!); });

  it("stores by content address, reads it back, and is idempotent", async () => {
    const obj = Buffer.from(randomBytes(2048));
    const a = await store.put(obj);
    assert.deepEqual(await store.get(a), obj);
    assert.equal(await store.has(a), true);
    assert.equal(await store.put(obj), a);
    assert.equal(await store.get("0".repeat(64)), null);
  });

  it("an insider overwrite creates a new version; the locked ORIGINAL is still recoverable", async () => {
    const obj = Buffer.from(randomBytes(4096));
    const a = await store.put(obj);
    const forged = Buffer.from(obj); forged[100] ^= 1;
    await store.unsafeOverwriteForDemo(a, forged);
    assert.deepEqual(await store.get(a), forged, "live object now differs");
    assert.deepEqual(await store.getOriginal(a), obj, "original version retained by versioning + Object Lock");
  });
});

describe("AWS: Cognito sign-in through the real login route", { skip: !enabled || !process.env.COGNITO_CLIENT_ID }, () => {
  it("logs in every demo role and rejects a wrong password", async () => {
    const { createPgliteDatabase, setDbForTests } = await import("../lib/db");
    const { ensureDemoUsers } = await import("../lib/seed");
    const { DEMO_USERS } = await import("../lib/demo-users");
    const { POST } = await import("../app/api/auth/login/route");
    const db = await createPgliteDatabase(); setDbForTests(db); await ensureDemoUsers(db);
    const pw = process.env.DEMO_PASSWORD!;
    const req = (email: string, password: string) => POST(new Request("http://x/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }));
    for (const u of DEMO_USERS) {
      const res = await req(u.email, pw);
      assert.equal(res.status, 200, u.email);
      assert.equal((await res.json()).user.role, u.role);
    }
    const bad = await req("police@sakshya.demo", "definitely-wrong");
    assert.equal(bad.status, 401);
    assert.equal((await bad.json()).error.message, "Invalid email or password");
    assert.equal((await req("stranger@example.com", pw)).status, 401);
    setDbForTests(undefined); await db.close();
  });
});
