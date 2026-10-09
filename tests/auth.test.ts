import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createPgliteDatabase, setDbForTests, type Database } from "../lib/db";
import { DEMO_USERS, demoUserByRole } from "../lib/demo-users";
import { ensureDemoUsers } from "../lib/seed";
import { cookieFrom, requireUser, SESSION_COOKIE, signSession, verifySession } from "../lib/session";
import { POST as login } from "../app/api/auth/login/route";
import { GET as sessionGet } from "../app/api/auth/session/route";
import { POST as logout } from "../app/api/auth/logout/route";

const PASSWORD = "test-password-123";
let db: Database;

const loginReq = (email: unknown, password: unknown) =>
  new Request("http://x/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];

before(async () => {
  process.env.DEMO_PASSWORD = PASSWORD;
  process.env.SESSION_SECRET = "x".repeat(40);
  db = await createPgliteDatabase();
  setDbForTests(db);
  await ensureDemoUsers(db);
});
after(async () => { setDbForTests(undefined); await db.close(); });

describe("session tokens", () => {
  const uid = demoUserByRole("POLICE").id;
  it("round-trips and rejects forged, tampered, expired and malformed tokens", () => {
    const t = signSession(uid);
    assert.equal(verifySession(t), uid);
    const [p, s] = t.split(".");
    assert.equal(verifySession(`${p}.${s.slice(0, -2)}AA`), null);
    const forgedPayload = Buffer.from(JSON.stringify({ uid: demoUserByRole("JUDGE").id, exp: 9999999999 })).toString("base64url");
    assert.equal(verifySession(`${forgedPayload}.${s}`), null, "payload swap with a valid signature of another payload");
    assert.equal(verifySession(signSession(uid, Date.now() - 9 * 3600 * 1000)), null, "expired");
    for (const bad of [null, undefined, "", "abc", "a.b.c", `${p}.`, `.${s}`]) assert.equal(verifySession(bad as string), null);
  });
  it("a token signed with a different secret is rejected", () => {
    const other = signSession(uid, Date.now(), { ...process.env, SESSION_SECRET: "y".repeat(40) });
    assert.equal(verifySession(other), null);
  });
  it("refuses to run in production without a strong secret", () => {
    assert.throws(() => signSession(uid, Date.now(), { NODE_ENV: "production" } as NodeJS.ProcessEnv), /SESSION_SECRET/);
  });
  it("reads a named cookie out of a header", () => {
    const r = new Request("http://x", { headers: { cookie: `a=1; ${SESSION_COOKIE}=tok; b=2` } });
    assert.equal(cookieFrom(r), "tok");
    assert.equal(cookieFrom(new Request("http://x")), null);
  });
});

describe("auth routes", () => {
  it("seeds one demo user per role", async () => {
    const roles = new Set(DEMO_USERS.map((u) => u.role));
    assert.equal(roles.size, 7);
    assert.equal(await ensureDemoUsers(db), 0, "idempotent");
  });

  it("login succeeds for every role and returns the Session contract", async () => {
    for (const u of DEMO_USERS) {
      const res = await login(loginReq(u.email.toUpperCase(), PASSWORD));
      assert.equal(res.status, 200, u.role);
      const body = await res.json();
      assert.equal(body.user.role, u.role);
      assert.equal(body.canCreateCase, u.role === "POLICE");
      assert.equal(body.assistantEnabled, false);
      const set = res.headers.get("set-cookie")!;
      assert.match(set, /HttpOnly/);
      assert.match(set, /SameSite=Lax/);
      assert.equal(res.headers.get("cache-control"), "no-store");
    }
  });

  it("wrong password and unknown email are indistinguishable 401s", async () => {
    const a = await login(loginReq(demoUserByRole("POLICE").email, "nope"));
    const b = await login(loginReq("nobody@x.in", PASSWORD));
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.deepEqual(await a.json(), await b.json());
  });

  it("malformed bodies are 422, not crashes", async () => {
    for (const body of [loginReq(1, 2), loginReq("a@b.c", undefined), new Request("http://x", { method: "POST", body: "not json" })])
      assert.equal((await login(body)).status, 422);
  });

  it("session returns the user from the cookie, re-reading the role from the database", async () => {
    const res = await login(loginReq(demoUserByRole("JUDGE").email, PASSWORD));
    const me = await sessionGet(new Request("http://x", { headers: { cookie: cookieOf(res) } }));
    assert.equal(me.status, 200);
    const body = await me.json();
    assert.equal(body.user.role, "JUDGE");
    assert.deepEqual(body.allowedUploadTypes, []);
  });

  it("no cookie, forged cookie, or deleted user → 401 envelope", async () => {
    const none = await sessionGet(new Request("http://x"));
    assert.equal(none.status, 401);
    assert.equal((await none.json()).error.code, "UNAUTHENTICATED");
    assert.equal((await sessionGet(new Request("http://x", { headers: { cookie: `${SESSION_COOKIE}=forged.token` } }))).status, 401);
    const ghost = signSession("deadbeef-0000-4000-8000-000000000000");
    assert.equal((await sessionGet(new Request("http://x", { headers: { cookie: `${SESSION_COOKIE}=${ghost}` } }))).status, 401);
    await assert.rejects(() => requireUser(new Request("http://x")));
  });

  it("logout clears the cookie", async () => {
    const res = await logout();
    assert.match(res.headers.get("set-cookie")!, /Max-Age=0/);
    assert.deepEqual(await res.json(), { ok: true });
  });
});
