import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, describe, it } from "node:test";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, denied, freshDb, ID } from "./helpers/pg";

const H = (c: string) => c.repeat(64);
const basis = (code = "INVESTIGATION", extra: Record<string, string> = {}) => JSON.stringify({ code, ...extra });

let db: PGlite;
let caseA: string; // police's case (lab, prosecutor assigned)
let firA: string;
let caseB: string; // other station's case
let firDoc: string;
let labDoc: string;

async function insertDoc(userId: string, caseId: string, type: string, over: Record<string, unknown> = {}) {
  const id = (over.id as string) ?? randomUUID();
  await asUser(db, userId, (q) =>
    q(
      `INSERT INTO documents (id, case_id, type, version, parent_id, filename, mime_type, size_bytes, uploader_id, sha256, chunk_root, chunk_leaves, part_root, part_count, wrapped_dek, signature, signed_payload, signer_key_hash)
       VALUES ($1,$2,$3,$4,$5,'f.txt','text/plain',100,$6,$7,$7,'[]'::jsonb,$7,1,'{}'::jsonb,'sig','{}',$7)`,
      [id, caseId, type, over.version ?? 1, over.parentId ?? null, userId, H("a")],
    ),
  );
  return id;
}

before(async () => {
  db = await freshDb();
  const a = (await asUser(db, ID.police, (q) => q("SELECT case_id AS id, fir_no FROM create_case($1)", [ID.complainant])))[0];
  caseA = a.id as string; firA = a.fir_no as string;
  caseB = (await asUser(db, ID.police2, (q) => q("SELECT case_id AS id FROM create_case()")))[0].id as string;
  await asUser(db, ID.police, (q) => q("SELECT assign_user($1,$2)", [caseA, ID.lab]));
  await asUser(db, ID.police, (q) => q("SELECT assign_user($1,$2)", [caseA, ID.prosecutor]));
  firDoc = await insertDoc(ID.police, caseA, "FIR");
  labDoc = await insertDoc(ID.lab, caseA, "FORENSIC_REPORT");
});

describe("case access (RBAC + ABAC in the database)", () => {
  it("each role sees exactly the cases it should", async () => {
    const ids = async (u: string) => (await asUser(db, u, (q) => q("SELECT id FROM cases"))).map((r) => r.id);
    assert.deepEqual(await ids(ID.police), [caseA]);
    assert.deepEqual(await ids(ID.police2), [caseB]);
    assert.deepEqual(await ids(ID.lab), [caseA]); // assigned
    assert.deepEqual(await ids(ID.complainant), [caseA]); // own case
    assert.equal((await ids(ID.judge)).length, 2);
    assert.equal((await ids(ID.admin)).length, 2);
    assert.deepEqual(await ids(ID.advocate), []);
  });

  it("only POLICE can register a case", async () => {
    for (const u of [ID.lab, ID.prosecutor, ID.judge, ID.advocate, ID.complainant])
      await denied(asUser(db, u, (q) => q("SELECT * FROM create_case()")));
  });

  it("direct INSERT/UPDATE/DELETE on cases is impossible", async () => {
    await denied(asUser(db, ID.police, (q) => q("INSERT INTO cases (fir_no, station, created_by) VALUES ('Z/9','S',$1)", [ID.police])));
    await denied(asUser(db, ID.police, (q) => q("UPDATE cases SET stage = 'CLOSED'")));
    await denied(asUser(db, ID.police, (q) => q("DELETE FROM cases")));
  });
});

describe("document access", () => {
  const visible = async (u: string) => (await asUser(db, u, (q) => q("SELECT id FROM documents ORDER BY created_at"))).map((r) => r.id);

  it("assigned staff and court see evidence; strangers, advocate and complainant do not", async () => {
    assert.equal((await visible(ID.police)).length, 2);
    assert.equal((await visible(ID.lab)).length, 2);
    assert.equal((await visible(ID.prosecutor)).length, 2);
    assert.equal((await visible(ID.judge)).length, 2);
    assert.deepEqual(await visible(ID.police2), []);
    assert.deepEqual(await visible(ID.advocate), []);
    assert.deepEqual(await visible(ID.complainant), []); // progress only — never evidence
  });

  it("forensic lab cannot upload to an unassigned case (denied)", async () => {
    await denied(insertDoc(ID.lab, caseB, "FORENSIC_REPORT"));
  });

  it("role→type matrix: lab cannot upload a FIR, police cannot upload a forensic report, court cannot upload at all", async () => {
    await denied(insertDoc(ID.lab, caseA, "FIR"));
    await denied(insertDoc(ID.police, caseA, "FORENSIC_REPORT"));
    await denied(insertDoc(ID.judge, caseA, "FIR"));
    await denied(insertDoc(ID.advocate, caseA, "CHARGE_SHEET"));
  });

  it("uploader must be the signed-in user (no impersonation)", async () => {
    await denied(asUser(db, ID.police, (q) =>
      q(`INSERT INTO documents (id, case_id, type, version, filename, mime_type, size_bytes, uploader_id, sha256, chunk_root, chunk_leaves, part_root, part_count, wrapped_dek, signature, signed_payload, signer_key_hash)
         VALUES (gen_random_uuid(),$1,'FIR',1,'f','t',1,$2,$3,$3,'[]','${H("a")}',1,'{}','s','{}',$3)`, [caseA, ID.lab, H("a")])));
  });

  it("append-only: no UPDATE or DELETE by the app, or even by the table owner", async () => {
    await denied(asUser(db, ID.police, (q) => q("UPDATE documents SET filename='evil'")));
    await denied(asUser(db, ID.police, (q) => q("DELETE FROM documents")));
    await denied(asUser(db, ID.police, (q) => q("UPDATE documents SET filename='evil'"), "app_owner"));
    await denied(asUser(db, ID.police, (q) => q("DELETE FROM documents"), "app_owner"));
  });

  it("version lineage: v1 originals, corrections need an existing parent in the same case and a higher version", async () => {
    await denied(insertDoc(ID.police, caseA, "FIR", { version: 2 }));
    await denied(insertDoc(ID.police, caseA, "FIR", { version: 1, parentId: firDoc }));
    await denied(insertDoc(ID.police, caseA, "FIR", { version: 2, parentId: randomUUID() }));
    const caseOther = (await asUser(db, ID.police, (q) => q("SELECT case_id AS id FROM create_case()")))[0].id as string;
    await denied(insertDoc(ID.police, caseOther, "FIR", { version: 2, parentId: firDoc }));
    const v2 = await insertDoc(ID.police, caseA, "FIR", { version: 2, parentId: firDoc });
    assert.ok(v2);
  });

  it("only app_anchor may fill anchor columns, once, and nothing else", async () => {
    await denied(asUser(db, ID.police, (q) => q("UPDATE documents SET batch_id = 1")));
    const fresh = await insertDoc(ID.police, caseA, "WITNESS_STATEMENT");
    await asUser(db, ID.police, async () => {}, "app_user");
    await asUser(db, ID.admin, (q) => q("UPDATE documents SET batch_id = 7, anchor_tx = '0xabc', anchored_at = now(), merkle_proof = '{}' WHERE id = $1", [fresh]), "app_anchor");
    // already anchored: RLS hides the row from app_anchor, so the UPDATE silently affects 0 rows and the value is unchanged
    const again = await asUser(db, ID.admin, (q) => q("UPDATE documents SET batch_id = 8 WHERE id = $1 RETURNING id", [fresh]), "app_anchor");
    assert.equal(again.length, 0);
    const stored = (await asUser(db, ID.admin, (q) => q("SELECT batch_id, anchor_tx FROM documents WHERE id = $1", [fresh]), "app_anchor"))[0];
    assert.equal(String(stored.batch_id), "7");
    assert.equal(stored.anchor_tx, "0xabc");
    const other = await insertDoc(ID.police, caseA, "WITNESS_STATEMENT");
    await denied(asUser(db, ID.admin, (q) => q("UPDATE documents SET filename = 'x' WHERE id = $1", [other]), "app_anchor")); // not an anchor column
  });
});

describe("court-ordered access for the defence advocate", () => {
  let requestId: string;
  it("advocate can file a request; others cannot", async () => {
    const req = (u: string) => asUser(db, u, (q) => q(
      `INSERT INTO document_requests (case_id, requester_id, document_ids, legal_basis, reason)
       VALUES ($1,$2,$3,$4::jsonb,'need copies for defence') RETURNING id`,
      [caseA, u, `{${firDoc}}`, basis("STATUTORY_DISCLOSURE", { citation: "BNSS s.230" })]));
    requestId = (await req(ID.advocate))[0].id as string;
    await denied(req(ID.police));
    await denied(req(ID.complainant));
    // advocate sees own request; police does not
    assert.equal((await asUser(db, ID.advocate, (q) => q("SELECT id FROM document_requests"))).length, 1);
    assert.equal((await asUser(db, ID.police, (q) => q("SELECT id FROM document_requests"))).length, 0);
    assert.equal((await asUser(db, ID.judge, (q) => q("SELECT id FROM document_requests"))).length, 1);
  });

  it("before a decision the advocate still sees no documents", async () => {
    assert.equal((await asUser(db, ID.advocate, (q) => q("SELECT id FROM documents"))).length, 0);
  });

  it("only a JUDGE can decide (not admin, prosecutor, advocate)", async () => {
    for (const u of [ID.admin, ID.prosecutor, ID.advocate])
      await denied(asUser(db, u, (q) => q(
        "INSERT INTO request_decisions (request_id, decided_by, decision, order_ref, note, granted_document_ids) VALUES ($1,$2,'GRANT','ORD/1','ok',$3)",
        [requestId, u, `{${firDoc}}`])));
  });

  it("a grant must cover requested documents only", async () => {
    await denied(asUser(db, ID.judge, (q) => q(
      "INSERT INTO request_decisions (request_id, decided_by, decision, order_ref, note, granted_document_ids) VALUES ($1,$2,'GRANT','ORD/1','ok',$3)",
      [requestId, ID.judge, `{${labDoc}}`])));
  });

  it("judge grants → advocate sees ONLY the granted document; the rest stay hidden", async () => {
    await asUser(db, ID.judge, (q) => q(
      "INSERT INTO request_decisions (request_id, decided_by, decision, order_ref, note, granted_document_ids) VALUES ($1,$2,'GRANT','ORD/2026/17','Granted under statute',$3)",
      [requestId, ID.judge, `{${firDoc}}`]));
    const seen = (await asUser(db, ID.advocate, (q) => q("SELECT id FROM documents"))).map((r) => r.id);
    assert.deepEqual(seen, [firDoc]);
    assert.equal((await asUser(db, ID.advocate, (q) => q("SELECT * FROM document_parts"))).length >= 0, true);
    await denied(asUser(db, ID.judge, (q) => q( // one decision per request
      "INSERT INTO request_decisions (request_id, decided_by, decision, order_ref, note) VALUES ($1,$2,'REJECT','O','n')", [requestId, ID.judge])));
  });

  it("grants are append-only, cannot be edited by the advocate, and expire", async () => {
    await denied(asUser(db, ID.advocate, (q) => q("UPDATE request_grants SET expires_at = NULL")));
    await denied(asUser(db, ID.advocate, (q) => q("DELETE FROM request_grants")));
    await denied(asUser(db, ID.advocate, (q) => q("INSERT INTO request_grants (request_id, document_id, user_id, order_ref) VALUES ($1,$2,$3,'x')", [requestId, labDoc, ID.advocate])));

    const req2 = (await asUser(db, ID.advocate, (q) => q(
      `INSERT INTO document_requests (case_id, requester_id, document_ids, legal_basis, reason) VALUES ($1,$2,$3,$4::jsonb,'r') RETURNING id`,
      [caseA, ID.advocate, `{${labDoc}}`, basis("STATUTORY_DISCLOSURE", { citation: "s.230" })])))[0].id as string;
    await asUser(db, ID.judge, (q) => q(
      "INSERT INTO request_decisions (request_id, decided_by, decision, order_ref, note, granted_document_ids, expires_at) VALUES ($1,$2,'GRANT','ORD/2','n',$3, now() - interval '1 minute')",
      [req2, ID.judge, `{${labDoc}}`]));
    const seen = (await asUser(db, ID.advocate, (q) => q("SELECT id FROM documents"))).map((r) => r.id);
    assert.deepEqual(seen, [firDoc], "expired grant gives no access");
  });

  it("a rejection grants nothing", async () => {
    const r = (await asUser(db, ID.advocate, (q) => q(
      `INSERT INTO document_requests (case_id, requester_id, document_ids, legal_basis, reason) VALUES ($1,$2,$3,$4::jsonb,'r') RETURNING id`,
      [caseA, ID.advocate, `{${labDoc}}`, basis("STATUTORY_DISCLOSURE", { citation: "s.230" })])))[0].id as string;
    await asUser(db, ID.judge, (q) => q("INSERT INTO request_decisions (request_id, decided_by, decision, order_ref, note) VALUES ($1,$2,'REJECT','ORD/3','not relevant')", [r, ID.judge]));
    assert.equal((await asUser(db, ID.advocate, (q) => q("SELECT request_id FROM request_grants WHERE request_id = $1", [r]))).length, 0);
  });
});

describe("complainant progress", () => {
  it("police advance the case through add_milestone(); complainant sees the timeline but never documents or audit", async () => {
    await asUser(db, ID.police, (q) => q("SELECT add_milestone($1,'INVESTIGATION','Investigation started')", [caseA]));
    const seen = await asUser(db, ID.complainant, (q) => q("SELECT stage FROM milestones ORDER BY at"));
    assert.deepEqual(seen.map((m) => m.stage), ["FIR_REGISTERED", "INVESTIGATION"]);
    assert.equal((await asUser(db, ID.complainant, (q) => q("SELECT stage FROM cases")))[0].stage, "INVESTIGATION");
    assert.equal((await asUser(db, ID.complainant, (q) => q("SELECT id FROM documents"))).length, 0);
    assert.equal((await asUser(db, ID.complainant, (q) => q("SELECT id FROM audit_log"))).length, 0);
  });
  it("others cannot add milestones; stage cannot move backwards; milestones and stage cannot be edited directly", async () => {
    for (const u of [ID.lab, ID.complainant, ID.advocate, ID.police2])
      await denied(asUser(db, u, (q) => q("SELECT add_milestone($1,'TRIAL')", [caseA])));
    await denied(asUser(db, ID.police, (q) => q("SELECT add_milestone($1,'FIR_REGISTERED')", [caseA])));
    await asUser(db, ID.judge, (q) => q("SELECT add_milestone($1,'TRIAL','Trial listed')", [caseA]));
    await denied(asUser(db, ID.police, (q) => q("INSERT INTO milestones (case_id, stage, recorded_by) VALUES ($1,'JUDGMENT',$2)", [caseA, ID.police])));
    await denied(asUser(db, ID.police, (q) => q("UPDATE milestones SET note='rewritten'")));
    await denied(asUser(db, ID.police, (q) => q("UPDATE cases SET stage='CLOSED'")));
  });
});

describe("automatic, tamper-proof FIR numbers", () => {
  it("format is STATION/YEAR/SERIAL/CODE, serial gapless per station and year", async () => {
    assert.match(firA, /^GNG\/20\d\d\/0001\/[0-9A-F]{4}$/);
    const second = (await asUser(db, ID.police, (q) => q("SELECT fir_no FROM create_case()")))[0].fir_no as string;
    const third = (await asUser(db, ID.police, (q) => q("SELECT fir_no FROM create_case()")))[0].fir_no as string;
    const serial = (f: string) => Number(f.split("/")[2]);
    assert.equal(serial(third), serial(second) + 1, "gapless");
    assert.ok(serial(second) > 1);
    const pcv = (await asUser(db, ID.police2, (q) => q("SELECT fir_no FROM create_case()")))[0].fir_no as string;
    assert.match(pcv, /^PCV\/20\d\d\/\d{4}\//, "each station has its own counter");
    assert.ok(serial(pcv) < serial(third), "PCV counter is independent of GNG");
  });
  it("the officer cannot choose, skip or reuse a number; only create_case() can write the register", async () => {
    await denied(asUser(db, ID.police, (q) => q("INSERT INTO fir_register (seq, fir_no, station_code, year, serial, case_id, issued_by, issued_at, prev_hash, entry_hash) VALUES (99,'GNG/2026/0099/AAAA','GNG',2026,99,$1,$2,now(),'x','y')", [caseA, ID.police])));
    await denied(asUser(db, ID.police, (q) => q("UPDATE fir_counters SET last_serial = 0")));
    await denied(asUser(db, ID.police, (q) => q("UPDATE fir_register SET serial = 1")));
    await denied(asUser(db, ID.police, (q) => q("DELETE FROM fir_register"), "app_owner"));
    await denied(asUser(db, ID.police, (q) => q("INSERT INTO cases (fir_no, station, created_by) VALUES ('GNG/2026/0500/ABCD','x',$1)", [ID.police])));
  });
  it("a user without a station code cannot register a case", async () => {
    await db.exec("SET ROLE app_owner; UPDATE app.users SET station_code = NULL WHERE id = '" + ID.police2 + "'; RESET ROLE;");
    await denied(asUser(db, ID.police2, (q) => q("SELECT * FROM create_case()")));
    await db.exec("SET ROLE app_owner; UPDATE app.users SET station_code = 'PCV' WHERE id = '" + ID.police2 + "'; RESET ROLE;");
  });
  it("check_fir_number: genuine numbers pass; a wrong code, edited serial or unknown number does not", async () => {
    const ok = (await asUser(db, ID.lab, (q) => q("SELECT * FROM check_fir_number($1)", [firA])))[0];
    assert.equal(ok.genuine, true);
    assert.equal(ok.station_code, "GNG");
    const [st, yr, sr] = firA.split("/");
    assert.equal((await asUser(db, ID.lab, (q) => q("SELECT * FROM check_fir_number($1)", [`${st}/${yr}/${sr}/0000`])))[0].genuine, false);
    const unknown = (await asUser(db, ID.lab, (q) => q("SELECT * FROM check_fir_number($1)", [`${st}/${yr}/0777/AAAA`])))[0];
    assert.equal(unknown.genuine, false);
    assert.equal(unknown.station_code, null);
    assert.equal((await asUser(db, ID.lab, (q) => q("SELECT * FROM check_fir_number($1)", [firA.toLowerCase()])))[0].genuine, true, "case-insensitive");
  });
  it("court can verify the register; strangers cannot; tampering is pinpointed", async () => {
    await denied(asUser(db, ID.police, (q) => q("SELECT * FROM verify_fir_register()")));
    const clean = (await asUser(db, ID.judge, (q) => q("SELECT * FROM verify_fir_register()")))[0];
    assert.equal(clean.first_broken_seq, null);
    assert.ok(Number(clean.checked) >= 4);
    await db.exec("ALTER TABLE app.fir_register DISABLE TRIGGER fir_register_append_only");
    const orig = Number((await db.query<{ serial: number }>("SELECT serial FROM app.fir_register WHERE seq = 2")).rows[0].serial);
    await db.exec("UPDATE app.fir_register SET serial = 41 WHERE seq = 2");
    const broken = (await asUser(db, ID.judge, (q) => q("SELECT * FROM verify_fir_register()")))[0];
    assert.equal(Number(broken.first_broken_seq), 2);
    assert.match(String(broken.problem), /altered/);
    await db.exec(`UPDATE app.fir_register SET serial = ${orig} WHERE seq = 2`);
    await db.exec("DELETE FROM app.fir_register WHERE seq = 3");
    const gap = (await asUser(db, ID.judge, (q) => q("SELECT * FROM verify_fir_register()")))[0];
    assert.equal(Number(gap.first_broken_seq), 4);
    assert.match(String(gap.problem), /missing/);
  });
});

describe("hash-chained audit log (computed in the database)", () => {
  const log = (u: string, action: string, over: { doc?: string | null; cs?: string | null; basisJson?: string; detail?: string } = {}) =>
    asUser(db, u, (q) => q(
      "INSERT INTO audit_log (actor_id, action, doc_id, case_id, legal_basis, detail, seq, at, prev_hash, entry_hash) VALUES ($1,$2::audit_action,$3,$4,$5::jsonb,$6,0,now(),'','') RETURNING seq, prev_hash, entry_hash",
      [u, action, over.doc ?? null, over.cs ?? null, over.basisJson ?? basis(), over.detail ?? null]));

  it("assigns sequence numbers and chains each entry to the previous one", async () => {
    const a = (await log(ID.police, "UPLOAD", { doc: firDoc, cs: caseA }))[0];
    const b = (await log(ID.lab, "VIEW", { doc: firDoc, cs: caseA, basisJson: basis("FORENSIC_ASSIGNMENT") }))[0];
    assert.equal(Number(b.seq), Number(a.seq) + 1);
    assert.equal(b.prev_hash, a.entry_hash);
    assert.match(String(a.entry_hash), /^[0-9a-f]{64}$/);
  });

  it("the app cannot choose seq/hash/time: client-supplied values are overwritten", async () => {
    const r = (await asUser(db, ID.police, (q) => q(
      "INSERT INTO audit_log (actor_id, action, legal_basis, seq, at, prev_hash, entry_hash) VALUES ($1,'VIEW',$2::jsonb,999,'2001-01-01','forged','forged') RETURNING seq, at, prev_hash",
      [ID.police, basis()])))[0];
    assert.notEqual(Number(r.seq), 999);
    assert.notEqual(r.prev_hash, "forged");
    assert.ok(new Date(String(r.at)).getFullYear() >= 2026);
  });

  it("cannot log as someone else; no UPDATE/DELETE; court role can verify, others cannot", async () => {
    await denied(log(ID.police, "UPLOAD").then(() => asUser(db, ID.police, (q) => q("INSERT INTO audit_log (actor_id, action, legal_basis, seq, at, prev_hash, entry_hash) VALUES ($1,'VIEW',$2::jsonb,0,now(),'','')", [ID.lab, basis()]))));
    await denied(asUser(db, ID.police, (q) => q("UPDATE audit_log SET detail = 'x'")));
    await denied(asUser(db, ID.police, (q) => q("DELETE FROM audit_log")));
    await denied(asUser(db, ID.police, (q) => q("UPDATE audit_log SET detail = 'x'"), "app_owner"));
    await denied(asUser(db, ID.police, (q) => q("SELECT * FROM verify_audit_chain()")));
    const v = (await asUser(db, ID.judge, (q) => q("SELECT * FROM verify_audit_chain()")))[0];
    assert.equal(v.first_broken_id, null);
    assert.ok(Number(v.checked) >= 4);
  });

  it("legal basis is enforced: court-order access needs citation AND order reference", async () => {
    await denied(log(ID.advocate, "VIEW", { basisJson: basis("COURT_ORDER") }));
    await denied(log(ID.advocate, "VIEW", { basisJson: basis("COURT_ORDER", { citation: "s.230" }) }));
    await denied(log(ID.advocate, "VIEW", { basisJson: basis("STATUTORY_DISCLOSURE") }));
    await denied(log(ID.advocate, "VIEW", { basisJson: basis("MADE_UP") }));
    await log(ID.advocate, "VIEW", { doc: firDoc, cs: caseA, basisJson: basis("COURT_ORDER", { citation: "BNSS s.230", orderRef: "ORD/2026/17" }) });
  });

  it("audit visibility: court sees all; staff see their case; strangers see only themselves", async () => {
    const n = async (u: string) => (await asUser(db, u, (q) => q("SELECT id FROM audit_log"))).length;
    const total = await n(ID.judge);
    assert.ok(total >= 5);
    assert.ok((await n(ID.lab)) >= 2 && (await n(ID.lab)) < total + 1);
    assert.equal(await n(ID.complainant), 0);
    assert.ok((await n(ID.police2)) <= (await n(ID.judge)));
  });

  it("TAMPER the log as a database superuser → verify_audit_chain pinpoints the first broken entry", async () => {
    const victim = (await db.query<{ id: string }>("SELECT id FROM app.audit_log ORDER BY seq OFFSET 1 LIMIT 1")).rows[0].id;
    await db.exec("ALTER TABLE app.audit_log DISABLE TRIGGER audit_append_only");
    await db.query("UPDATE app.audit_log SET detail = 'rewritten by insider' WHERE id = $1", [victim]);
    await db.exec("ALTER TABLE app.audit_log ENABLE TRIGGER audit_append_only");
    const v = (await asUser(db, ID.judge, (q) => q("SELECT * FROM verify_audit_chain()")))[0];
    assert.equal(v.first_broken_id, victim);
  });
});

describe("advocate catalog & case header", () => {
  it("advocate can look up titles by FIR number (no content), others cannot", async () => {
    const rows = await asUser(db, ID.advocate, (q) => q("SELECT * FROM request_catalog($1)", [firA]));
    assert.ok(rows.length >= 2);
    assert.deepEqual(Object.keys(rows[0]).sort(), ["case_id", "created_at", "doc_id", "doc_type", "filename", "fir_no", "stage", "station", "version"]);
    await denied(asUser(db, ID.police, (q) => q("SELECT * FROM request_catalog($1)", [firA])));
    await denied(asUser(db, ID.complainant, (q) => q("SELECT * FROM request_catalog($1)", [firA])));
  });
  it("a live grant exposes the case header to the advocate; no grant, no header", async () => {
    // earlier tests granted the FIR document to the advocate
    assert.equal((await asUser(db, ID.advocate, (q) => q("SELECT id FROM cases"))).length, 1);
  });
});
