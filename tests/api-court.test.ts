import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { POST as casesPost } from "../app/api/cases/route";
import { GET as caseGet } from "../app/api/cases/[id]/route";
import { POST as assemblePost } from "../app/api/cases/[id]/assemble/route";
import { GET as bundleGet } from "../app/api/cases/[id]/bundle/route";
import { POST as docsPost } from "../app/api/documents/route";
import { GET as docGet } from "../app/api/documents/[id]/route";
import { POST as restorePost } from "../app/api/documents/[id]/restore/route";
import { GET as contentGet } from "../app/api/documents/[id]/content/route";
import { GET as requestsGet, POST as requestsPost } from "../app/api/requests/route";
import { GET as catalogGet } from "../app/api/requests/catalog/route";
import { POST as decisionPost } from "../app/api/requests/[id]/decision/route";
import { GET as auditGet } from "../app/api/audit/route";
import { anchorPending } from "../lib/anchoring";
import { clearBundlesForTests } from "../lib/bundle-store";
import { setChainForTests } from "../lib/chain";
import { insiderAttack } from "../lib/demo-attack";
import { readZip } from "../lib/zip";
import { call, setup, uploadForm, userOf, type Harness } from "./helpers/api";
import { fakeChain } from "./helpers/fake-chain";

let h: Harness;
const police = userOf("POLICE").id, lab = userOf("FORENSIC_LAB").id, judge = userOf("JUDGE").id, admin = userOf("ADMIN").id,
  advocate = userOf("DEFENCE_ADVOCATE").id, complainant = userOf("COMPLAINANT").id, prosecutor = userOf("PUBLIC_PROSECUTOR").id,
  police2 = userOf("POLICE", "police2@sakshya.demo").id;
const text = (n: number, k = 0) => Buffer.from(Array.from({ length: n }, (_, i) => String.fromCharCode(65 + ((i + k) % 26))).join(""));
const pdfBytes = Buffer.concat([Buffer.from("%PDF-1.4\n"), text(70_000, 3), Buffer.from("\n%%EOF")]); // 2 storage parts
let caseId: string, firNo: string; let fir: string, stmt: string, report: string;
const chain = fakeChain();
const future = (ms: number) => new Date(Date.now() + ms).toISOString();

before(async () => {
  h = await setup();
  const c = await call(casesPost, "POST", { as: police, body: { complainantEmail: "complainant@sakshya.demo" } });
  caseId = c.json.id; firNo = c.json.firNo;
  await h.db.withUser(police, async (tx) => { await tx.query("SELECT assign_user($1,$2)", [caseId, lab]); await tx.query("SELECT assign_user($1,$2)", [caseId, prosecutor]); });
  fir = (await call(docsPost, "POST", { as: police, form: uploadForm(caseId, "FIR", "FIR.txt", text(12_000), "text/plain") })).json.document.id;
  stmt = (await call(docsPost, "POST", { as: police, form: uploadForm(caseId, "WITNESS_STATEMENT", "statement.txt", text(8_000, 5), "text/plain") })).json.document.id;
  report = (await call(docsPost, "POST", { as: lab, form: uploadForm(caseId, "FORENSIC_REPORT", "lab report.pdf", pdfBytes, "application/pdf") })).json.document.id;
});
after(async () => { clearBundlesForTests(); await chain.service.idle(); await h.close(); });

describe("advocate requests and the judge's decision", () => {
  it("the catalog shows titles only and is limited to advocates and the court", async () => {
    const r = await call(catalogGet, "GET", { as: advocate, query: { firNo } });
    assert.equal(r.status, 200);
    assert.equal(r.json.caseId, caseId);
    assert.equal(r.json.documents.length, 3);
    assert.deepEqual(Object.keys(r.json.documents[0]).sort(), ["createdAt", "filename", "id", "type", "version"]);
    assert.equal((await call(catalogGet, "GET", { as: advocate, query: { firNo: "XXX/2026/0001/0000" } })).status, 404);
    assert.equal((await call(catalogGet, "GET", { as: police, query: { firNo } })).status, 403);
    assert.equal((await call(catalogGet, "GET", { as: complainant, query: { firNo } })).status, 403);
  });

  it("filing is advocate-only and validated; the case and documents stay hidden until granted", async () => {
    const body = { caseId, documentIds: [fir, report, stmt], legalBasis: { code: "STATUTORY_DISCLOSURE", citation: "BNSS 2023 s.230" }, reason: "Copies needed to prepare the defence" };
    assert.equal((await call(requestsPost, "POST", { as: police, body })).status, 403);
    assert.equal((await call(requestsPost, "POST", { as: advocate, body: { ...body, legalBasis: { code: "STATUTORY_DISCLOSURE", citation: " " } } })).status, 422);
    assert.equal((await call(requestsPost, "POST", { as: advocate, body: { ...body, legalBasis: { code: "INVESTIGATION", citation: "x" } } })).status, 422);
    assert.equal((await call(requestsPost, "POST", { as: advocate, body: { ...body, documentIds: [] } })).status, 422);
    assert.equal((await call(requestsPost, "POST", { as: advocate, body: { ...body, documentIds: ["00000000-0000-4000-8000-000000000001"] } })).status, 422);
    assert.equal((await call(requestsPost, "POST", { as: advocate, body: { ...body, reason: "" } })).status, 422);
    const ok = await call(requestsPost, "POST", { as: advocate, body });
    assert.equal(ok.status, 201);
    assert.equal(ok.json.status, "PENDING");
    assert.equal(ok.json.firNo, firNo);
    assert.equal(ok.json.legalBasis.citation, "BNSS 2023 s.230");
    assert.equal(ok.json.decision, null);
    assert.equal((await call(caseGet, "GET", { as: advocate, params: { id: caseId } })).status, 404, "no access before the order");
    assert.equal((await call(docGet, "GET", { as: advocate, params: { id: fir } })).status, 404);
  });

  it("list scoping: judge sees all, advocate sees own, others are refused", async () => {
    assert.equal((await call(requestsGet, "GET", { as: judge })).json.items.length, 1);
    assert.equal((await call(requestsGet, "GET", { as: advocate, query: { status: "PENDING" } })).json.items.length, 1);
    assert.equal((await call(requestsGet, "GET", { as: judge, query: { status: "GRANTED" } })).json.items.length, 0);
    assert.equal((await call(requestsGet, "GET", { as: judge, query: { status: "BOGUS" } })).status, 422);
    assert.equal((await call(requestsGet, "GET", { as: police })).status, 403);
  });

  it("only a judge decides; a grant needs an order reference and may cover a subset", async () => {
    const id = (await call(requestsGet, "GET", { as: judge })).json.items[0].id;
    const ok = { decision: "GRANT", orderRef: "ORD/2026/114", note: "Statement withheld pending cross-examination", grantedDocumentIds: [fir, report], expiresAt: future(3_600_000) };
    assert.equal((await call(decisionPost, "POST", { as: advocate, params: { id }, body: ok })).status, 403);
    assert.equal((await call(decisionPost, "POST", { as: admin, params: { id }, body: ok })).status, 403, "ADMIN is not a judge");
    assert.equal((await call(decisionPost, "POST", { as: judge, params: { id }, body: { ...ok, orderRef: " " } })).status, 422);
    assert.equal((await call(decisionPost, "POST", { as: judge, params: { id }, body: { ...ok, grantedDocumentIds: ["00000000-0000-4000-8000-000000000001"] } })).status, 422);
    assert.equal((await call(decisionPost, "POST", { as: judge, params: { id }, body: { ...ok, expiresAt: "2001-01-01T00:00:00Z" } })).status, 422);
    const done = await call(decisionPost, "POST", { as: judge, params: { id }, body: ok });
    assert.equal(done.status, 200);
    assert.equal(done.json.status, "GRANTED");
    assert.equal(done.json.decision.orderRef, "ORD/2026/114");
    assert.deepEqual(done.json.decision.grantedDocumentIds.sort(), [fir, report].sort());
    assert.equal(done.json.decision.permission, "VIEW_AND_WATERMARKED_DOWNLOAD");
    assert.equal((await call(decisionPost, "POST", { as: judge, params: { id }, body: ok })).status, 422, "one decision per request");
    assert.equal((await call(requestsGet, "GET", { as: advocate })).json.items[0].status, "GRANTED");
  });

  it("the advocate reads exactly the granted documents, watermarked, under the court-order basis", async () => {
    const d = await call(docGet, "GET", { as: advocate, params: { id: fir } });
    assert.equal(d.status, 200);
    assert.equal(d.json.access.via, "GRANT");
    assert.equal(d.json.access.orderRef, "ORD/2026/114");
    assert.equal((await call(docGet, "GET", { as: advocate, params: { id: stmt } })).status, 404, "not part of the order");
    assert.equal((await call(caseGet, "GET", { as: advocate, params: { id: caseId } })).json.canAssemble, true);

    const t = await call(contentGet, "GET", { as: advocate, params: { id: fir }, query: { disposition: "attachment" } });
    assert.equal(t.status, 200);
    const body = Buffer.from(await t.res.arrayBuffer()).toString("utf8");
    assert.match(body, /^Sakshya copy · Adv\. Sanjay Rao · Order ORD\/2026\/114 · sha256 [0-9a-f]{16}…/);
    assert.ok(body.endsWith(text(12_000).toString()));
    assert.equal(t.res.headers.get("x-sakshya-watermark-mode"), "embedded");
    assert.match(t.res.headers.get("content-disposition")!, /filename="granted-ORD_2026_114_FIR.txt"/);

    const p = await call(contentGet, "GET", { as: advocate, params: { id: report }, query: { disposition: "attachment" } });
    assert.deepEqual(Buffer.from(await p.res.arrayBuffer()), pdfBytes, "PDFs are byte-identical");
    assert.equal(p.res.headers.get("x-sakshya-watermark-mode"), "filename-and-header-only");
    assert.match(decodeURIComponent(p.res.headers.get("x-sakshya-watermark")!), /Order ORD\/2026\/114/);

    const trail = await call(auditGet, "GET", { as: judge, query: { docId: fir, limit: "20" } });
    const mine = trail.json.items.find((e: { action: string; role: string }) => e.action === "DOWNLOAD" && e.role === "DEFENCE_ADVOCATE");
    assert.equal(mine.legalBasis.code, "COURT_ORDER");
    assert.equal(mine.legalBasis.orderRef, "ORD/2026/114");
    const acts = (await call(auditGet, "GET", { as: judge, query: { caseId, limit: "200" } })).json.items.map((e: { action: string }) => e.action);
    assert.ok(acts.includes("REQUEST_FILED") && acts.includes("REQUEST_GRANTED"));
  });

  it("a rejection records the order but opens nothing; an expired grant stops working", async () => {
    const rej = await call(requestsPost, "POST", { as: advocate, body: { caseId, documentIds: [stmt], legalBasis: { code: "COURT_ORDER", citation: "Order dated 2 Oct" }, reason: "Need the witness statement" } });
    const r = await call(decisionPost, "POST", { as: judge, params: { id: rej.json.id }, body: { decision: "REJECT", orderRef: "ORD/2026/115", note: "Premature" } });
    assert.equal(r.json.status, "REJECTED");
    assert.deepEqual(r.json.decision.grantedDocumentIds, []);
    assert.equal((await call(contentGet, "GET", { as: advocate, params: { id: stmt } })).status, 404);

    const short = await call(requestsPost, "POST", { as: advocate, body: { caseId, documentIds: [stmt], legalBasis: { code: "STATUTORY_DISCLOSURE", citation: "BNSS s.230" }, reason: "Second try" } });
    await call(decisionPost, "POST", { as: judge, params: { id: short.json.id }, body: { decision: "GRANT", orderRef: "ORD/2026/116", note: "Limited window", expiresAt: future(1500) } });
    assert.equal((await call(contentGet, "GET", { as: advocate, params: { id: stmt } })).status, 200);
    await new Promise((r) => setTimeout(r, 1800));
    assert.equal((await call(contentGet, "GET", { as: advocate, params: { id: stmt } })).status, 404, "grant expired");
    assert.equal((await call(requestsGet, "GET", { as: advocate, query: { status: "EXPIRED" } })).json.items.length, 1);
  });
});

describe("case folder assembly", () => {
  it("before anchoring the folder is verified but no bundle is offered; roles are enforced", async () => {
    assert.equal((await call(assemblePost, "POST", { as: police, params: { id: caseId } })).status, 403);
    assert.equal((await call(assemblePost, "POST", { as: complainant, params: { id: caseId } })).status, 403);
    assert.equal((await call(assemblePost, "POST", { as: police2, params: { id: caseId } })).status, 403);
    const r = await call(assemblePost, "POST", { as: judge, params: { id: caseId } });
    assert.equal(r.status, 200);
    assert.equal(r.json.scope, "FULL_CASE");
    assert.equal(r.json.totals.documents, 3);
    assert.equal(r.json.totals.parts, 4, "1 + 1 + 2 stored parts");
    assert.equal(r.json.totals.partsVerified, 4);
    assert.equal(r.json.totals.tampered, 0);
    assert.equal(r.json.manifest.root, r.json.manifest.recomputed);
    assert.equal(r.json.bundle, null, "UNANCHORED documents do not qualify for a bundle");
    assert.ok(r.json.documents.every((d: { verification: { status: string } }) => d.verification.status === "UNANCHORED"));
  });

  it("after anchoring: bundle offered, downloadable once by its owner, valid ZIP with manifest and certificate", async () => {
    assert.ok(await anchorPending({ chainService: chain.service }));
    // seal the sealed-in-DB manifest on the (fake) chain as the live service does on upload
    const m = await h.db.withAdmin(async (tx) => (await tx.query("SELECT version, root, doc_count FROM case_manifests WHERE case_id = $1 ORDER BY version DESC LIMIT 1", [caseId])).rows[0]);
    await chain.service.sealCaseManifest({ caseId, firNo, version: Number(m.version), root: m.root, documentCount: Number(m.doc_count) });
    await chain.service.idle();
    setChainForTests(chain.service);

    const r = await call(assemblePost, "POST", { as: prosecutor, params: { id: caseId } });
    assert.equal(r.status, 200);
    assert.ok(r.json.documents.every((d: { verification: { status: string } }) => d.verification.status === "VERIFIED"));
    assert.equal(r.json.manifest.onChain, "pass");
    assert.ok(r.json.bundle);
    const token = new URL(r.json.bundle.downloadPath, "http://x").searchParams.get("token")!;
    assert.equal((await call(bundleGet, "GET", { as: judge, params: { id: caseId }, query: { token } })).status, 404, "bound to the user who assembled it");
    assert.equal((await call(bundleGet, "GET", { as: prosecutor, params: { id: caseId }, query: { token: "bogus" } })).status, 404);
    const dl = await call(bundleGet, "GET", { as: prosecutor, params: { id: caseId }, query: { token } });
    assert.equal(dl.status, 200);
    assert.equal(dl.res.headers.get("content-type"), "application/zip");
    const zip = Buffer.from(await dl.res.arrayBuffer());
    assert.equal(zip.length, r.json.bundle.sizeBytes);
    const files = readZip(zip);
    assert.deepEqual(files.map((f) => f.name).filter((n) => n.startsWith("documents/")).length, 3);
    assert.ok(files.some((f) => f.name === "manifest.json") && files.some((f) => f.name === "CERTIFICATE.txt"));
    assert.deepEqual(files.find((f) => f.name.endsWith("lab report.pdf"))!.data, pdfBytes);
    const cert = files.find((f) => f.name === "CERTIFICATE.txt")!.data.toString();
    assert.match(cert, /verified OFF-CHAIN/);
    assert.match(cert, new RegExp(firNo));
    const trail = (await call(auditGet, "GET", { as: judge, query: { caseId, action: "DOWNLOAD", limit: "100" } })).json.items;
    assert.ok(trail.filter((e: { detail: string }) => e.detail?.includes("bundle")).length >= 3);
  });

  it("an advocate's folder contains only granted documents, marked with the order", async () => {
    // the first grant is still live for FIR + report (1 h); the 1.5 s grant on the statement has expired
    const r = await call(assemblePost, "POST", { as: advocate, params: { id: caseId } });
    assert.equal(r.status, 200);
    assert.equal(r.json.scope, "GRANTED_DOCUMENTS");
    assert.equal(r.json.manifest, null);
    assert.equal(r.json.totals.documents, 2);
    assert.ok(r.json.bundle);
    const token = new URL(r.json.bundle.downloadPath, "http://x").searchParams.get("token")!;
    const zip = Buffer.from(await (await call(bundleGet, "GET", { as: advocate, params: { id: caseId }, query: { token } })).res.arrayBuffer());
    const files = readZip(zip);
    const txt = files.find((f) => f.name.includes("FIR.txt"))!;
    assert.match(txt.data.toString(), /^Sakshya copy · Adv\. Sanjay Rao · Order ORD\/2026\/114/);
    assert.match(files.find((f) => f.name === "CERTIFICATE.txt")!.data.toString(), /Granted copy/);
  });

  it("a manifest root that disagrees with the chain withholds the bundle; a tampered document is localised", async () => {
    chain.registry.manifests.set([...chain.registry.manifests.keys()][0], { root: `0x${"cd".repeat(32)}`, version: 1 });
    const m = await h.db.withAdmin(async (tx) => Number((await tx.query("SELECT max(version) AS v FROM case_manifests WHERE case_id = $1", [caseId])).rows[0].v));
    const key = [...chain.registry.manifests.keys()][0];
    chain.registry.manifests.set(key, { root: `0x${"cd".repeat(32)}`, version: m });
    const bad = await call(assemblePost, "POST", { as: judge, params: { id: caseId } });
    assert.equal(bad.json.manifest.onChain, "fail");
    assert.equal(bad.json.bundle, null);

    await insiderAttack(stmt, 4000);
    const t = await call(assemblePost, "POST", { as: admin, params: { id: caseId } });
    assert.equal(t.json.totals.tampered, 1);
    assert.equal(t.json.bundle, null);
    const doc = t.json.documents.find((d: { document: { id: string } }) => d.document.id === stmt);
    assert.equal(doc.verification.status, "TAMPERED");
    assert.equal(doc.verification.parts[0].status, "fail");
    assert.equal(doc.verification.tamperRanges[0].chunkIndex, 0);
    const acts = (await call(auditGet, "GET", { as: judge, query: { caseId, limit: "300" } })).json.items.map((e: { action: string }) => e.action);
    assert.ok(acts.includes("FOLDER_ASSEMBLED") && acts.includes("TAMPER_DETECTED"));
  });

  it("after a restore the superseded damaged version stays in the report but the bundle holds only current, verified documents", async () => {
    chain.registry.manifests.clear(); // chain state is not what this test is about
    const rest = await call(restorePost, "POST", { as: police, params: { id: stmt }, body: { reason: "Restore retained original after incident" } });
    assert.equal(rest.status, 201);
    assert.ok(await anchorPending({ chainService: chain.service }));
    const r = await call(assemblePost, "POST", { as: judge, params: { id: caseId } });
    assert.equal(r.json.totals.documents, 4);
    assert.equal(r.json.totals.tampered, 1, "history of the incident is reported");
    assert.ok(r.json.bundle, "current versions are all VERIFIED");
    const token = new URL(r.json.bundle.downloadPath, "http://x").searchParams.get("token")!;
    const files = readZip(Buffer.from(await (await call(bundleGet, "GET", { as: judge, params: { id: caseId }, query: { token } })).res.arrayBuffer()));
    const names = files.map((f) => f.name).filter((n) => n.startsWith("documents/"));
    assert.equal(names.length, 3);
    assert.ok(names.some((n) => n.includes("statement.txt") && n.includes("_v2_")) && !names.some((n) => n.includes("statement.txt") && n.includes("_v1_")));
    assert.match(files.find((f) => f.name === "manifest.json")!.data.toString(), /supersededVersions/);
  });
});
