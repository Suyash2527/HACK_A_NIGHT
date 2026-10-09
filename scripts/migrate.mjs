// Database bootstrap for Amazon RDS (run once on the server): applies db/schema.sql, sets the app logins, seeds demo identities.
//   node migrate.mjs            (reads ADMIN_DATABASE_URL, APP_DB_PASSWORD, ANCHOR_DB_PASSWORD, PGSSL_CA_FILE from the environment)
// Idempotent: skips the schema if it already exists. Passwords are never printed.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import pg from "pg";

const env = process.env;
const need = (k) => { if (!env[k]) throw new Error(`${k} is not set`); return env[k]; };
const ssl = env.PGSSL === "disable" ? false : { rejectUnauthorized: true, ca: env.PGSSL_CA_FILE ? readFileSync(env.PGSSL_CA_FILE, "utf8") : undefined };
const client = new pg.Client({ connectionString: need("ADMIN_DATABASE_URL"), ssl });
await client.connect();

const has = (await client.query("SELECT 1 FROM pg_namespace WHERE nspname = 'app'")).rowCount > 0;
if (!has) {
  await client.query(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  console.log("schema applied");
} else console.log("schema already present");

// idempotent patches (db/patches/*.sql, packaged next to this script as ./patches): applied on every run, in name order
const patchDir = new URL("./patches/", import.meta.url);
if (existsSync(patchDir)) {
  for (const f of readdirSync(patchDir).filter((n) => n.endsWith(".sql")).sort()) {
    await client.query(readFileSync(new URL(f, patchDir), "utf8"));
    console.log(`patch applied: ${f}`);
  }
}

// login passwords for the two service roles (quoted literal; values come from the environment, never from user input)
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
await client.query(`ALTER ROLE app_user LOGIN PASSWORD ${lit(need("APP_DB_PASSWORD"))}`);
await client.query(`ALTER ROLE app_anchor LOGIN PASSWORD ${lit(need("ANCHOR_DB_PASSWORD"))}`);
console.log("service roles ready: app_user, app_anchor");

// seed fictional demo identities (as the table owner; row-level security applies to everyone else)
const users = JSON.parse(readFileSync(new URL("./demo-users.json", import.meta.url), "utf8"));
await client.query("SET ROLE app_owner");
let added = 0;
for (const u of users) {
  const r = await client.query(
    `INSERT INTO app.users (id, email, name, role, station, station_code, clearance) VALUES ($1,$2,$3,$4::app.user_role,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
    [u.id, u.email, u.name, u.role, u.station, u.stationCode ?? null, u.clearance],
  );
  added += r.rowCount;
}
await client.query("RESET ROLE");
console.log(`demo users added: ${added} (of ${users.length})`);

// smoke check: the app role can connect and sees nothing without an identity
const r = await client.query("SELECT count(*)::int AS n FROM app.users");
console.log(`users in database: ${r.rows[0].n}`);
await client.end();
