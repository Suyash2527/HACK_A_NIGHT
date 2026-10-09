// In-process harness for route tests: real handlers, real RLS (PGlite), local part store, no chain.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateSeeds } from "../../lib/crypto/pqc";
import { createPgliteDatabase, setDbForTests, type Database } from "../../lib/db";
import { DEMO_USERS, demoUserByRole } from "../../lib/demo-users";
import { setChainForTests } from "../../lib/chain";
import { signSession } from "../../lib/session";
import { ensureDemoUsers } from "../../lib/seed";
import type { Role } from "../../types/api";

export interface Harness { db: Database; dir: string; close(): Promise<void> }

export async function setup(): Promise<Harness> {
  const s = generateSeeds();
  Object.assign(process.env, { PQC_KEM_SEED: s.kemSeed, PQC_DSA_SEED: s.dsaSeed, SESSION_SECRET: "t".repeat(40), SAKSHYA_ALLOW_ATTACK_IN_TESTS: "1" });
  delete process.env.S3_EVIDENCE_BUCKET;
  const dir = await mkdtemp(path.join(tmpdir(), "sakshya-api-"));
  process.env.PART_STORE_DIR = dir;
  setChainForTests(null);
  const db = await createPgliteDatabase();
  setDbForTests(db);
  await ensureDemoUsers(db);
  return { db, dir, close: async () => { setDbForTests(undefined); setChainForTests(undefined); await db.close(); await rm(dir, { recursive: true, force: true }); } };
}

export const userOf = (role: Role, email?: string) => (email ? DEMO_USERS.find((u) => u.email === email)! : demoUserByRole(role));
export const cookieFor = (id: string) => `sakshya_session=${signSession(id)}`;

type Handler = (req: Request, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response>;
export interface CallOpts { as?: string | null; body?: unknown; form?: FormData; params?: Record<string, string>; query?: Record<string, string> }

/** Calls a route handler as the given demo user id (null/omitted = anonymous). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function call(handler: Handler, method: string, opts: CallOpts = {}): Promise<{ status: number; json: any; res: Response }> {
  const url = new URL("http://sakshya.test/api/x");
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (opts.as) headers.cookie = cookieFor(opts.as);
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) { body = JSON.stringify(opts.body); headers["content-type"] = "application/json"; }
  const res = await handler(new Request(url, { method, headers, body }), { params: Promise.resolve(opts.params ?? {}) });
  const ct = res.headers.get("content-type") ?? "";
  const json = ct.includes("json") ? await res.clone().json() : null;
  return { status: res.status, json, res };
}

export function uploadForm(caseId: string, type: string, filename: string, bytes: Uint8Array | string, mime: string, parentId?: string): FormData {
  const f = new FormData();
  f.set("file", new File([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], filename, { type: mime }));
  f.set("caseId", caseId); f.set("type", type);
  if (parentId) f.set("parentId", parentId);
  return f;
}
