// SERVER-ONLY database access. One interface, two drivers:
//   • DATABASE_URL set  → node-postgres pool to Amazon RDS (production; connects as the non-owner `app_user`)
//   • otherwise         → embedded Postgres (PGlite) persisted in .data/db (local dev / offline demo)
// Every call runs in a transaction that FIRST binds the caller's identity:
//   SELECT set_config('app.user_id', <uuid>, true)      -- txn-local, can never leak across pooled connections
// Row-level security policies key on that value, so even a buggy query cannot read another user's rows.
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
export interface QueryResult<T = Row> { rows: T[]; rowCount: number }
export interface Tx {
  query<T = Row>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}
export interface Database {
  /** Runs fn as `userId`. RLS applies. Commits on success, rolls back on throw. */
  withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Runs fn as the anchoring service role (may only fill anchor columns). */
  withAnchor<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Owner/admin access for migrations and seeding ONLY. Never call from request handlers. */
  withAdmin<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const assertUuid = (v: string) => {
  if (!UUID.test(v)) throw new Error("invalid user id");
};

const schemaSql = () => readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8");

// ───────────────────────────── PGlite (embedded) driver
type PGliteLike = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Row[]; affectedRows?: number }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

export async function createPgliteDatabase(dataDir?: string): Promise<Database> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dataDir) mkdirSync(path.dirname(dataDir), { recursive: true });
  const db = (dataDir ? new PGlite(dataDir) : new PGlite()) as unknown as PGliteLike;
  const hasSchema = (await db.query("SELECT 1 AS ok FROM pg_namespace WHERE nspname = 'app'")).rows.length > 0;
  if (!hasSchema) await db.exec(schemaSql());

  // PGlite is a single connection: serialise transactions.
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail.then(job, job);
    tail = run.catch(() => undefined);
    return run;
  };

  const tx: Tx = {
    async query<T = Row>(sql: string, params?: unknown[]) {
      const r = await db.query(sql, params);
      return { rows: r.rows as T[], rowCount: r.affectedRows || r.rows.length };
    },
  };
  const run = <T>(setup: string, params: unknown[], fn: (t: Tx) => Promise<T>): Promise<T> =>
    serial(async () => {
      await db.exec("BEGIN");
      try {
        await db.exec(setup.replace("$USER", params[0] ? `'${String(params[0])}'` : "''"));
        const out = await fn(tx);
        await db.exec("COMMIT");
        return out;
      } catch (e) {
        await db.exec("ROLLBACK").catch(() => undefined);
        throw e;
      }
    });

  return {
    withUser: async (userId, fn) => {
      assertUuid(userId);
      return run("SELECT set_config('app.user_id', $USER, true); SET LOCAL ROLE app_user; SET LOCAL search_path = app, pg_catalog", [userId], fn);
    },
    withAnchor: (fn) => run("SELECT set_config('app.user_id', '', true); SET LOCAL ROLE app_anchor; SET LOCAL search_path = app, pg_catalog", [], fn),
    withAdmin: (fn) => run("SET LOCAL search_path = app, pg_catalog", [], fn),
    close: () => db.close(),
  };
}

// ───────────────────────────── node-postgres (RDS) driver
export async function createPgDatabase(env: NodeJS.ProcessEnv = process.env): Promise<Database> {
  const pg = (await import("pg")).default;
  const ssl = env.PGSSL === "disable" ? false : { rejectUnauthorized: true, ca: env.PGSSL_CA_FILE ? readFileSync(env.PGSSL_CA_FILE, "utf8") : undefined };
  const pool = (url: string | undefined) => new pg.Pool({ connectionString: url, max: 10, ssl });
  const main = pool(env.DATABASE_URL);
  const anchor = env.ANCHOR_DATABASE_URL ? pool(env.ANCHOR_DATABASE_URL) : null;
  const admin = env.ADMIN_DATABASE_URL ? pool(env.ADMIN_DATABASE_URL) : null;

  const run = async <T>(p: InstanceType<typeof pg.Pool>, userId: string | null, fn: (t: Tx) => Promise<T>): Promise<T> => {
    const client = await p.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL search_path = app, pg_catalog"); // same schema resolution as the embedded driver
      if (userId !== null) await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      const t: Tx = { query: async (sql, params) => { const r = await client.query(sql, params as unknown[]); return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length }; } };
      const out = await fn(t);
      await client.query("COMMIT");
      return out;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  };

  return {
    withUser: async (userId, fn) => { assertUuid(userId); return run(main, userId, fn); },
    withAnchor: (fn) => run(anchor ?? main, "", fn),
    withAdmin: (fn) => { if (!admin) throw new Error("ADMIN_DATABASE_URL not configured"); return run(admin, null, fn); },
    close: async () => { await Promise.all([main.end(), anchor?.end(), admin?.end()]); },
  };
}

// ───────────────────────────── singleton (survives Next.js dev hot reloads)
const g = globalThis as unknown as { __sakshyaDb?: Promise<Database> };

export function getDb(): Promise<Database> {
  if (g.__sakshyaDb) return g.__sakshyaDb;
  const created = (process.env.DATABASE_URL
    ? createPgDatabase()
    : createPgliteDatabase(process.env.PGLITE_DIR || path.join(process.cwd(), ".data", "db")).then(async (db) => {
        // local embedded database only: make sure the fictional demo identities exist (idempotent)
        if (process.env.SAKSHYA_SEED_DEMO !== "0") await (await import("./seed")).ensureDemoUsers(db);
        return db;
      }));
  // a failed start must not be cached forever: allow the next request to retry
  created.catch(() => { if (g.__sakshyaDb === created) g.__sakshyaDb = undefined; });
  return (g.__sakshyaDb = created);
}

/** Test hook: make the singleton point at an injected database. */
export function setDbForTests(db: Database | undefined): void {
  g.__sakshyaDb = db ? Promise.resolve(db) : undefined;
}

/** Runs fn as the user. The common entry point for API routes. */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await getDb()).withUser(userId, fn);
}
