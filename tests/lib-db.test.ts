import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { courtOrderBasis, defaultBasis, logDenied, writeAudit } from "../lib/audit";
import { createPgliteDatabase, setDbForTests, type Database } from "../lib/db";
import { ApiError, errorResponse, fromDbError, requireRows } from "../lib/errors";
import { allowedUploadTypes, canRestoreDoc, canUploadType, requireRole } from "../lib/policy";
import { ID } from "./helpers/pg";

let db: Database;

before(async () => {
  db = await createPgliteDatabase();
  setDbForTests(db);
  await db.withAdmin((tx) =>
    tx.query(
      `INSERT INTO users (id, email, name, role, station, station_code) VALUES
       ('${ID.police}','p@x.in','Insp. Patil','POLICE','Gangapur','GNG'),
       ('${ID.judge}','j@x.in','Justice Joshi','JUDGE','Nashik',NULL),
       ('${ID.advocate}','d@x.in','Adv. Rao','DEFENCE_ADVOCATE','',NULL)`,
    ),
  );
});
after(async () => { setDbForTests(undefined); await db.close(); });

describe("database access layer", () => {
  it("binds the user identity per transaction and does not leak it afterwards", async () => {
    const inside = await db.withUser(ID.police, async (tx) => (await tx.query("SELECT app_uid() AS u, app_role() AS r")).rows[0]);
    assert.equal(inside.u, ID.police);
    assert.equal(inside.r, "POLICE");
    const after = await db.withAdmin(async (tx) => (await tx.query("SELECT current_setting('app.user_id', true) AS u")).rows[0].u);
    assert.ok(after === "" || after === null, "identity must not persist after the transaction");
  });

  it("rejects malformed user ids (no SQL injection through the identity)", async () => {
    await assert.rejects(() => db.withUser("x'; DROP SCHEMA app; --", async () => 1), /invalid user id/);
  });

  it("rolls back on error", async () => {
    await assert.rejects(() => db.withUser(ID.police, async (tx) => {
      await tx.query("SELECT * FROM create_case()");
      throw new Error("boom");
    }), /boom/);
    const rows = await db.withUser(ID.judge, async (tx) => (await tx.query("SELECT id FROM cases")).rows);
    assert.equal(rows.length, 0);
  });

  it("serialises concurrent transactions without mixing identities", async () => {
    const results = await Promise.all(
      [ID.police, ID.judge, ID.advocate, ID.police, ID.judge].map((u) => db.withUser(u, async (tx) => (await tx.query("SELECT app_uid() AS u")).rows[0].u)),
    );
    assert.deepEqual(results, [ID.police, ID.judge, ID.advocate, ID.police, ID.judge]);
  });
});

describe("audit writer", () => {
  it("appends chained entries inside the caller's transaction", async () => {
    const [a, b] = await db.withUser(ID.police, async (tx) => [
      await writeAudit(tx, { actorId: ID.police, action: "UPLOAD", basis: defaultBasis("POLICE"), detail: "first" }),
      await writeAudit(tx, { actorId: ID.police, action: "VIEW", basis: defaultBasis("POLICE") }),
    ]);
    assert.equal(b.seq, a.seq + 1);
    assert.equal(b.prevHash, a.entryHash);
  });

  it("rolls the audit entry back together with a failed action", async () => {
    const before = await db.withUser(ID.judge, async (tx) => Number((await tx.query("SELECT count(*) AS n FROM audit_log")).rows[0].n));
    await assert.rejects(() => db.withUser(ID.police, async (tx) => {
      await writeAudit(tx, { actorId: ID.police, action: "UPLOAD", basis: defaultBasis("POLICE") });
      throw new Error("action failed");
    }));
    const after = await db.withUser(ID.judge, async (tx) => Number((await tx.query("SELECT count(*) AS n FROM audit_log")).rows[0].n));
    assert.equal(after, before);
  });

  it("logDenied records a DENIED entry in its own transaction and never throws", async () => {
    await logDenied(ID.police, "tried to open an unassigned case");
    const row = await db.withUser(ID.judge, async (tx) => (await tx.query("SELECT action, detail FROM audit_log WHERE action = 'DENIED' ORDER BY seq DESC LIMIT 1")).rows[0]);
    assert.equal(row.action, "DENIED");
    assert.match(row.detail, /unassigned case/);
    await logDenied(randomUUID(), "unknown actor"); // FK failure is swallowed, not thrown
  });

  it("court-order basis requires citation and order reference; advocates have no default basis", async () => {
    assert.throws(() => defaultBasis("DEFENCE_ADVOCATE"));
    await assert.rejects(() => db.withUser(ID.advocate, (tx) => writeAudit(tx, { actorId: ID.advocate, action: "VIEW", basis: { code: "COURT_ORDER", citation: null, orderRef: null } })));
    const r = await db.withUser(ID.advocate, (tx) => writeAudit(tx, { actorId: ID.advocate, action: "VIEW", basis: courtOrderBasis("BNSS s.230", "ORD/2026/17") }));
    assert.ok(r.entryHash);
  });
});

describe("errors & policy", () => {
  it("maps database errors to the API envelope", async () => {
    let e: unknown;
    try { await db.withUser(ID.judge, (tx) => tx.query("INSERT INTO cases (fir_no, station, created_by) VALUES ('x','y',$1)", [ID.judge])); } catch (x) { e = x; }
    assert.equal(fromDbError(e)?.code, "FORBIDDEN");
    const res = errorResponse(new ApiError("TAMPERED", "Integrity mismatch", { chunk: 2 }));
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: { code: "TAMPERED", message: "Integrity mismatch", details: { chunk: 2 } } });
    assert.equal(errorResponse(new ApiError("TOO_LARGE", "File exceeds 4 MB")).status, 413);
  });

  it("silent RLS filtering is treated as not-found, never success", () => {
    assert.throws(() => requireRows([], "Document"), (e: unknown) => e instanceof ApiError && e.code === "NOT_FOUND");
    assert.equal(requireRows([1]).length, 1);
  });

  it("policy mirrors the role→type matrix", () => {
    assert.deepEqual(allowedUploadTypes("POLICE"), ["FIR", "WITNESS_STATEMENT"]);
    assert.equal(canUploadType("FORENSIC_LAB", "FIR"), false);
    assert.deepEqual(allowedUploadTypes("JUDGE"), []);
    assert.throws(() => requireRole("FORENSIC_LAB", ["POLICE"], "register a case"), (e: unknown) => e instanceof ApiError && e.code === "FORBIDDEN");
    assert.equal(canRestoreDoc("POLICE", "POLICE", "FIR"), true);
    assert.equal(canRestoreDoc("JUDGE", "POLICE", "FIR"), false);
    assert.equal(canRestoreDoc("FORENSIC_LAB", "POLICE", "FIR"), false);
  });
});
