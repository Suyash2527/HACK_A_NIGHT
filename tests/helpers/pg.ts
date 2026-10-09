// Test helper: a real Postgres engine (PGlite, WASM) loaded with db/schema.sql. Mirrors production roles and RLS.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";

export const ID = {
  police: "aaaaaaaa-0000-4000-8000-000000000001",
  lab: "aaaaaaaa-0000-4000-8000-000000000002",
  prosecutor: "aaaaaaaa-0000-4000-8000-000000000003",
  judge: "aaaaaaaa-0000-4000-8000-000000000004",
  admin: "aaaaaaaa-0000-4000-8000-000000000005",
  advocate: "aaaaaaaa-0000-4000-8000-000000000006",
  complainant: "aaaaaaaa-0000-4000-8000-000000000007",
  police2: "aaaaaaaa-0000-4000-8000-000000000008",
} as const;

export async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8"));
  await db.exec(`
    SET ROLE app_owner; SET search_path = app, pg_catalog;
    INSERT INTO users (id, email, name, role, station, station_code) VALUES
      ('${ID.police}','p@x.in','Insp. Aditi Patil','POLICE','Gangapur','GNG'),
      ('${ID.lab}','l@x.in','Dr. Neha Kulkarni','FORENSIC_LAB','Nashik FSL',NULL),
      ('${ID.prosecutor}','r@x.in','Adv. Rohan Deshmukh','PUBLIC_PROSECUTOR','Nashik',NULL),
      ('${ID.judge}','j@x.in','Justice Meera Joshi','JUDGE','Nashik',NULL),
      ('${ID.admin}','a@x.in','Demo Admin','ADMIN','HQ',NULL),
      ('${ID.advocate}','d@x.in','Adv. Sanjay Rao','DEFENCE_ADVOCATE','',NULL),
      ('${ID.complainant}','c@x.in','Complainant','COMPLAINANT','',NULL),
      ('${ID.police2}','p2@x.in','Insp. Other','POLICE','Panchavati','PCV');
    RESET ROLE;`);
  return db;
}

/** Runs sql as app_user with app.user_id set for the transaction (exactly how the web app does it). */
export async function asUser<T>(db: PGlite, userId: string, fn: (q: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>) => Promise<T>, role = "app_user"): Promise<T> {
  await db.exec("BEGIN");
  try {
    await db.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    await db.exec(`SET LOCAL ROLE ${role}; SET LOCAL search_path = app, pg_catalog`);
    const out = await fn(async (sql, params) => (await db.query(sql, params as unknown[])).rows as Record<string, unknown>[]);
    await db.exec("COMMIT");
    return out;
  } catch (e) {
    await db.exec("ROLLBACK");
    throw e;
  }
}

/** Expects an operation to be refused by the database (RLS / privilege / append-only / constraint). */
export async function denied(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return String((e as Error).message); }
  throw new Error("expected the database to refuse this operation, but it succeeded");
}
