// End-to-end rehearsal of the five demo scenes against a RUNNING deployment, with real logins.
//   npx tsx scripts/e2e-live.mts https://3-109-114-12.sslip.io        (needs DEMO_PASSWORD in .env.local; never printed)
// It creates ONE new fictional case and walks it through: upload → zero-trust denial → on-chain verification → insider attack →
// integrity scan → restore → case-folder assembly. Exit code 1 if any step fails.
import { existsSync } from "node:fs";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const PASSWORD = process.env.DEMO_PASSWORD;
if (!PASSWORD) { console.error("DEMO_PASSWORD is not set"); process.exit(2); }

const jars = new Map<string, string>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = any;
async function login(email: string) {
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  if (res.status !== 200 || !cookie) throw new Error(`login failed for ${email}: HTTP ${res.status}`);
  jars.set(email, cookie);
  return ((await res.json()) as J).user;
}
async function api(email: string, method: string, path: string, body?: unknown, form?: FormData): Promise<{ status: number; json: J; res: Response }> {
  const headers: Record<string, string> = { cookie: jars.get(email) ?? "" };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const ct = res.headers.get("content-type") ?? "";
  return { status: res.status, json: ct.includes("json") ? await res.clone().json() : null, res };
}
let failed = 0;
const ok = (cond: unknown, label: string, extra = "") => { console.log(`${cond ? "  PASS" : "  FAIL"}  ${label}${extra ? "  — " + extra : ""}`); if (!cond) failed++; return Boolean(cond); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(label: string, fn: () => Promise<T | null | false>, timeoutMs = 240_000, everyMs = 10_000): Promise<T | null> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - t0 > timeoutMs) { ok(false, `${label} (timed out after ${Math.round((Date.now() - t0) / 1000)}s)`); return null; }
    await sleep(everyMs);
  }
}

const POLICE = "police@sakshya.demo", LAB = "lab@sakshya.demo", PROS = "prosecutor@sakshya.demo", JUDGE = "judge@sakshya.demo",
  ADMIN = "admin@sakshya.demo", ADV = "advocate@sakshya.demo", COMP = "complainant@sakshya.demo";

console.log(`\nTarget: ${BASE}\n`);
console.log("Logins");
for (const e of [POLICE, LAB, PROS, JUDGE, ADMIN, ADV, COMP]) { const u = await login(e); ok(u?.role, `${e} → ${u?.role}`); }

console.log("\nScene 1 — police registers a case and uploads a FIR");
const created = await api(POLICE, "POST", "/api/cases", { complainantEmail: COMP });
ok(created.status === 200 && /^[A-Z]{2,4}\/\d{4}\/\d{4}\/[0-9A-F]{4}$/.test(created.json.firNo), "case registered with a system-assigned FIR number", created.json?.firNo);
const caseId: string = created.json.id, firNo: string = created.json.firNo;
const body = Buffer.from(Array.from({ length: 16_384 }, (_, i) => String.fromCharCode(65 + (i % 26))).join(""));
const fd = new FormData();
fd.set("file", new File([new Uint8Array(body)], "FIR_E2E.txt", { type: "text/plain" })); fd.set("caseId", caseId); fd.set("type", "FIR");
const up = await api(POLICE, "POST", "/api/documents", undefined, fd);
ok(up.status === 201 && up.json.verification.status === "UNANCHORED", "FIR uploaded (encrypted in parts, ML-DSA signed)", `HTTP ${up.status}`);
const docId: string = up.json.document.id;
const fc = await api(COMP, "GET", `/api/fir/check?firNo=${encodeURIComponent(firNo)}`);
ok(fc.json?.genuine === true, "FIR number checks as genuine");
const forged = await api(COMP, "GET", `/api/fir/check?firNo=${encodeURIComponent(firNo.slice(0, -4) + "0000")}`);
ok(forged.json?.genuine === false, "a forged FIR number is rejected");

console.log("\nScene 2 — zero trust");
const denied = await api(LAB, "GET", `/api/cases/${caseId}`);
ok(denied.status === 404, "forensic lab cannot open an unassigned case", `HTTP ${denied.status}`);
const dc = await api(LAB, "GET", `/api/documents/${docId}/content`);
ok(dc.status === 404, "…nor read its content", `HTTP ${dc.status}`);
const adv = await api(ADV, "GET", `/api/documents/${docId}`);
ok(adv.status === 404, "advocate sees nothing without a court order");
const comp = await api(COMP, "GET", `/api/documents?caseId=${caseId}`);
ok(comp.status === 404 || comp.json?.items?.length === 0, "complainant sees no documents");
const progress = await api(COMP, "GET", `/api/cases/${caseId}/progress`);
ok(progress.status === 200 && progress.json.milestones.length >= 1, "complainant sees the milestone timeline only");
const audit = await api(JUDGE, "GET", `/api/audit?action=DENIED&limit=20`);
ok(audit.status === 200 && audit.json.items.some((e: J) => e.caseId === caseId || e.docId === docId), "the denial is in the audit log with a legal basis", audit.json?.items?.[0]?.legalBasis?.code);
ok((await api(POLICE, "GET", "/api/audit")).status === 403, "police cannot browse the audit explorer");

console.log("\nScene 3 — on-chain verification (waits for real Sepolia confirmations)");
const chainInfo = await api(JUDGE, "GET", "/api/chain");
ok(chainInfo.status === 200 && chainInfo.json.network === "sepolia", "chain configured", `${chainInfo.json?.network} ${chainInfo.json?.registryAddress}`);
const verified = await until("document reaches VERIFIED", async () => {
  const v = await api(JUDGE, "POST", `/api/documents/${docId}/verify`);
  process.stdout.write(`    …${v.json?.status}\n`);
  return v.json?.status === "VERIFIED" ? v.json : false;
}, 420_000, 15_000);
if (verified) {
  ok(Object.values(verified.checks).every((c) => c === "pass"), "all six checks pass");
  ok(/^https:\/\/sepolia\.etherscan\.io\/tx\/0x[0-9a-f]{64}$/.test(verified.anchor?.explorerUrl ?? ""), "Etherscan link for the anchor transaction", verified.anchor?.explorerUrl);
}
const feed = await api(JUDGE, "GET", `/api/chain/transactions?docId=${docId}`);
ok(feed.json?.items?.some((t: J) => t.kind === "REGISTER_RECORD" && t.status === "confirmed"), "REGISTER_RECORD confirmed on chain");
ok(feed.json?.items?.some((t: J) => t.kind === "ATTEST_SIGNATURE" && t.status === "confirmed"), "ATTEST_SIGNATURE confirmed on chain");
const batches = await api(JUDGE, "GET", "/api/batches");
ok(batches.json?.items?.some((b: J) => b.status === "confirmed"), "a Merkle batch is anchored");
const ac = await api(JUDGE, "POST", "/api/audit/verify");
ok(ac.json?.status === "pass", "audit hash chain verifies", `${ac.json?.checkedEntries} entries, headAnchored=${ac.json?.headAnchored}`);
const fr = await api(ADMIN, "POST", "/api/fir/verify-register");
ok(fr.json?.status === "pass", "FIR register verifies", `${fr.json?.checkedEntries} entries`);

console.log("\nScene 4 — insider attack → scan → restore");
const atk = await api(ADMIN, "POST", "/api/demo/attack", { docId, offset: 9000 });
if (ok(atk.status === 200, "insider flips one byte (valid re-encryption)", `HTTP ${atk.status}`)) {
  const scan = await api(JUDGE, "POST", "/api/integrity/scans", { caseId });
  const bad = scan.json?.results?.find((r: J) => r.document.id === docId);
  ok(bad?.verification.status === "TAMPERED", "scan finds the document TAMPERED");
  const r0 = bad?.verification.tamperRanges?.[0];
  ok(r0?.chunkIndex === 2 && r0?.byteStart === 8192 && r0?.byteEnd === 12287, "tamper localised to chunk 2, bytes 8192–12287", JSON.stringify(r0));
  ok(bad?.verification.checks.decrypt === "pass", "authenticated decryption still passes (valid attacker)");
  ok(bad?.verification.originalVersionAvailable === true, "retained original available (S3 Object Lock)");
  ok((await api(POLICE, "GET", `/api/documents/${docId}/content`)).status === 409, "content is withheld (409 TAMPERED)");
  ok((await api(JUDGE, "POST", `/api/documents/${docId}/restore`, { reason: "judge tries to restore" })).status === 403, "a judge cannot restore evidence");
  const rest = await api(POLICE, "POST", `/api/documents/${docId}/restore`, { reason: "Recover retained original after demo integrity incident" });
  ok(rest.status === 201 && rest.json.document.version === 2 && rest.json.document.parentId === docId, "restore appends version 2 from the locked original");
  const v2: string = rest.json?.document?.id;
  const c2 = await api(POLICE, "GET", `/api/documents/${v2}/content`);
  ok(c2.status === 200 && Buffer.from(await c2.res.arrayBuffer()).equals(body), "restored content is byte-identical to the original upload");
  ok((await api(JUDGE, "POST", `/api/documents/${docId}/verify`)).json?.status === "TAMPERED", "the damaged v1 stays red (incident history preserved)");
  console.log("\nScene 4b — new version anchors and turns green");
  const v2ok = await until("restored version reaches VERIFIED", async () => {
    const v = await api(JUDGE, "POST", `/api/documents/${v2}/verify`);
    process.stdout.write(`    …${v.json?.status}\n`);
    return v.json?.status === "VERIFIED" ? v.json : false;
  }, 420_000, 15_000);
  ok(!!v2ok, "restored version is VERIFIED on-chain");

  console.log("\nScene 5 — case folder");
  const asm = await api(JUDGE, "POST", `/api/cases/${caseId}/assemble`);
  ok(asm.status === 200 && asm.json.totals.tampered === 1, "assembly reports the historic tamper", JSON.stringify(asm.json?.totals));
  ok(!!asm.json?.bundle, "bundle offered (current versions all VERIFIED)");
  if (asm.json?.bundle) {
    const z = await api(JUDGE, "GET", asm.json.bundle.downloadPath);
    const buf = Buffer.from(await z.res.arrayBuffer());
    ok(z.status === 200 && buf.subarray(0, 2).toString() === "PK", "bundle downloads as a ZIP", `${buf.length} bytes`);
  }
}

console.log(`\nCase ${firNo} (${caseId}) left in place as a rehearsal record.`);
console.log(failed ? `\n${failed} CHECK(S) FAILED\n` : "\nALL CHECKS PASSED\n");
process.exit(failed ? 1 : 0);
