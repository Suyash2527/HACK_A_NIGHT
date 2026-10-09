// Smoke test of the imported data and the court-order flows against a running deployment (real logins).
//   npx tsx scripts/smoke-live.mts https://3-109-114-12.sslip.io        (DEMO_PASSWORD from .env.local, never printed)
import { existsSync } from "node:fs";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const PASSWORD = process.env.DEMO_PASSWORD;
if (!PASSWORD) { console.error("DEMO_PASSWORD is not set"); process.exit(2); }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = any;
const jar = new Map<string, string>();
async function login(email: string) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status}`);
  jar.set(email, (r.headers.get("set-cookie") ?? "").split(";")[0]);
}
async function api(email: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { cookie: jar.get(email) ?? "", ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json: J = (res.headers.get("content-type") ?? "").includes("json") ? await res.clone().json() : null;
  return { status: res.status, json, res };
}
async function allCases(email: string) {
  const out: J[] = []; let cursor = "";
  for (;;) { const r = await api(email, "GET", `/api/cases?limit=100${cursor ? `&cursor=${cursor}` : ""}`); out.push(...r.json.items); if (!r.json.nextCursor) return out; cursor = r.json.nextCursor; }
}
let failed = 0;
const ok = (c: unknown, l: string, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${l}${x ? "  — " + x : ""}`); if (!c) failed++; return !!c; };
const E = { police: "police@sakshya.demo", police2: "police2@sakshya.demo", police3: "police3@sakshya.demo", lab: "lab@sakshya.demo", pros: "prosecutor@sakshya.demo",
  judge: "judge@sakshya.demo", admin: "admin@sakshya.demo", adv: "advocate@sakshya.demo", comp: "complainant@sakshya.demo" };
for (const e of Object.values(E)) await login(e);

console.log("\nImported data, per role");
const judgeCases = await allCases(E.judge);
const docs = judgeCases.reduce((n, c) => n + c.documentCount, 0);
ok(judgeCases.length >= 40, "court sees every case", `${judgeCases.length} cases, ${docs} documents (includes any rehearsal cases)`);
const counts: Record<string, number> = {};
for (const [k, e] of Object.entries(E)) counts[k] = (await allCases(e)).length;
console.log("   cases per login:", JSON.stringify(counts));
ok(counts.police > 0 && counts.police2 > 0 && counts.police3 > 0, "each police station sees its own cases");
ok(counts.police + counts.police2 + counts.police3 === counts.judge, "station views partition the court view");
ok(counts.lab >= 40 && counts.pros >= 40, "lab and prosecutor are assigned to the imported cases");
ok(counts.adv === 0, "advocate sees no case before an order");
ok(counts.comp >= 1, "complainant sees only their own case(s)", String(counts.comp));

console.log("\nAnchoring of the imported documents");
const b = await api(E.judge, "GET", "/api/batches?limit=10");
ok(b.json.items.some((x: J) => x.status === "confirmed" && x.documentCount >= 100), "a confirmed batch covers the imported documents", JSON.stringify(b.json.items.map((x: J) => [x.batchId, x.documentCount, x.status])));

console.log("\nComplainant progress");
const mine = (await allCases(E.comp))[0];
if (mine) {
  const p = await api(E.comp, "GET", `/api/cases/${mine.id}/progress`);
  ok(p.status === 200 && p.json.milestones.length >= 2, "milestone timeline", `${p.json.firNo}: ${p.json.currentStage}, ${p.json.milestones.length} milestones`);
  ok((await api(E.comp, "GET", `/api/documents?caseId=${mine.id}`)).json?.items?.length === 0 || (await api(E.comp, "GET", `/api/documents?caseId=${mine.id}`)).status === 404, "…and no documents");
}

console.log("\nAdvocate request → judge grant → watermarked access");
const target = judgeCases.find((c) => c.stage === "TRIAL" && c.documentCount >= 4) ?? judgeCases[0];
const cat = await api(E.adv, "GET", `/api/requests/catalog?firNo=${encodeURIComponent(target.firNo)}`);
ok(cat.status === 200 && cat.json.documents.length === target.documentCount, "catalog lists titles by FIR number", target.firNo);
const pick = cat.json.documents.slice(0, 2).map((d: J) => d.id);
const req = await api(E.adv, "POST", "/api/requests", { caseId: target.id, documentIds: pick, legalBasis: { code: "STATUTORY_DISCLOSURE", citation: "BNSS 2023 s.230" }, reason: "Copies needed to prepare the defence" });
ok(req.status === 201 && req.json.status === "PENDING", "request filed");
ok((await api(E.adv, "GET", `/api/documents/${pick[0]}`)).status === 404, "no access before the order");
const dec = await api(E.judge, "POST", `/api/requests/${req.json.id}/decision`, { decision: "GRANT", orderRef: `ORD/SMOKE/${Date.now() % 100000}`, note: "Granted for defence preparation", expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
ok(dec.status === 200 && dec.json.status === "GRANTED", "judge grants with an order reference");
const det = await api(E.adv, "GET", `/api/documents/${pick[0]}`);
ok(det.json?.access?.via === "GRANT", "advocate opens the granted document", det.json?.access?.orderRef);
const dl = await api(E.adv, "GET", `/api/documents/${pick[0]}/content?disposition=attachment`);
ok(dl.status === 200 && !!dl.res.headers.get("x-sakshya-watermark"), "download carries the watermark", dl.res.headers.get("x-sakshya-watermark-mode") ?? "");
const other = cat.json.documents.find((d: J) => !pick.includes(d.id));
if (other) ok((await api(E.adv, "GET", `/api/documents/${other.id}`)).status === 404, "documents outside the order stay hidden");

console.log("\nCase folder bundle");
const asm = await api(E.judge, "POST", `/api/cases/${target.id}/assemble`);
ok(asm.status === 200, "assembly runs", JSON.stringify(asm.json?.totals));
ok(asm.json?.documents?.every((d: J) => d.verification.status === "VERIFIED"), "every document VERIFIED on-chain", asm.json?.documents?.map((d: J) => d.verification.status).join(","));
if (asm.json?.bundle) {
  const z = await api(E.judge, "GET", asm.json.bundle.downloadPath);
  ok(z.status === 200 && Buffer.from(await z.res.arrayBuffer()).subarray(0, 2).toString() === "PK", "bundle downloads as ZIP");
} else ok(false, "bundle offered");
const aasm = await api(E.adv, "POST", `/api/cases/${target.id}/assemble`);
ok(aasm.status === 200 && aasm.json.scope === "GRANTED_DOCUMENTS" && aasm.json.totals.documents === pick.length, "advocate folder holds only granted documents");

console.log("\nCourt checks");
ok((await api(E.judge, "POST", "/api/audit/verify")).json?.status === "pass", "audit chain verifies");
ok((await api(E.admin, "POST", "/api/fir/verify-register")).json?.status === "pass", "FIR register verifies");
const scan = await api(E.judge, "POST", "/api/integrity/scans", { caseId: target.id });
ok(scan.status === 200 && scan.json.results.every((r: J) => r.verification.status === "VERIFIED"), "case scan clean");
console.log(failed ? `\n${failed} CHECK(S) FAILED\n` : "\nALL CHECKS PASSED\n");
process.exit(failed ? 1 : 0);
