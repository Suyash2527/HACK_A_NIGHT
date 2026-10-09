// SERVER-ONLY case-folder assembly: fetch every permitted part, verify each document, rebuild the folder manifest and compare it with
// the one sealed on-chain. A downloadable bundle exists ONLY if every included document is VERIFIED.
import { createHash } from "node:crypto";
import type { AssemblyReport, CheckStatus, VerifyResult } from "@/types/api";
import { defaultBasis, logDenied, writeAudit } from "./audit";
import { putBundle, getBundle } from "./bundle-store";
import { getDb } from "./db";
import { forbidden, invalid, notFound, requireRows } from "./errors";
import { buildManifest, docLeaf } from "./merkle";
import { canAssemble } from "./policy";
import type { SessionUser } from "./session";
import { basisFor, chainOf, iso, loadDoc, readerOf, recordVerification, storeOf, toSummary, verifyLoaded, DOC_SELECT, type EvidenceDeps, type LoadedDoc, type TamperEvent } from "./evidence";
import { watermark } from "./watermark";
import { buildZip, type ZipEntry } from "./zip";

export const MAX_ASSEMBLY_DOCS = 60;
const MAX_BUNDLE_BYTES = 48 * 1024 * 1024;
const CONCURRENCY = 6;

export async function assembleCase(user: SessionUser, caseId: string, deps?: EvidenceDeps): Promise<AssemblyReport> {
  if (!canAssemble(user.role)) { await logDenied(user.id, "case assembly refused: role not allowed", { caseId }); throw forbidden("Your role cannot assemble case folders"); }
  const db = await getDb();
  const store = storeOf(deps), reader = await readerOf(deps), chain = await chainOf(deps);
  const advocate = user.role === "DEFENCE_ADVOCATE";

  // 1. what this user may include (row-level security decides: court/assigned prosecutor → all; advocate → granted documents only)
  const prep = await db.withUser(user.id, async (tx) => {
    const c = (await tx.query("SELECT id, fir_no FROM cases WHERE id = $1", [caseId])).rows[0];
    if (!c) throw notFound("Case unavailable");
    const ids = (await tx.query<{ id: string }>("SELECT id FROM documents WHERE case_id = $1 ORDER BY created_at, id", [caseId])).rows;
    if (!ids.length) throw notFound("No documents are available to you in this case");
    if (ids.length > MAX_ASSEMBLY_DOCS) throw invalid(`A case folder holds at most ${MAX_ASSEMBLY_DOCS} documents here`);
    const docs: LoadedDoc[] = [];
    for (const { id } of ids) docs.push(await loadDoc(tx, id));
    const manifest = advocate ? null : (await tx.query("SELECT version, root FROM case_manifests WHERE case_id = $1 ORDER BY version DESC LIMIT 1", [caseId])).rows[0] ?? null;
    return { firNo: c.fir_no as string, docs, manifest };
  }).catch(async (e) => { if ((e as { code?: string }).code === "NOT_FOUND") await logDenied(user.id, "case assembly refused: case not accessible", { caseId }); throw e; });

  // 2. verify everything outside any transaction
  const fitsInMemory = prep.docs.reduce((n, d) => n + Number(d.row.size_bytes), 0) <= MAX_BUNDLE_BYTES;
  const outs: { result: VerifyResult; plaintext: Buffer | null }[] = new Array(prep.docs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, prep.docs.length) }, async () => {
    for (let i = next++; i < prep.docs.length; i = next++) {
      outs[i] = await verifyLoaded(prep.docs[i], store, reader);
      if (!fitsInMemory) outs[i].plaintext = null; // too large to bundle: do not hold the plaintext
    }
  }));

  // 3. manifest: recompute from the documents and compare with the sealed one and with the chain
  let manifest: AssemblyReport["manifest"] = null;
  if (prep.manifest) {
    const recomputed = buildManifest(prep.docs.map((d) => docLeaf(d.row.id, d.row.sha256, d.row.chunk_root, d.row.part_root))).root;
    let onChain: CheckStatus = "skip";
    if (chain) {
      const m = await chain.manifestOnChain(caseId).catch(() => null);
      if (m && m.version === Number(prep.manifest.version)) onChain = m.root === prep.manifest.root ? "pass" : "fail";
    }
    manifest = { root: prep.manifest.root, version: Number(prep.manifest.version), recomputed, onChain };
  }

  // 4. persist results + audit
  const events: TamperEvent[] = [];
  const saved = await db.withUser(user.id, async (tx) => {
    const firstBasis = await basisFor(tx, user, prep.docs[0].row.id);
    for (let i = 0; i < prep.docs.length; i++) {
      const b = advocate ? await basisFor(tx, user, prep.docs[i].row.id) : defaultBasis(user.role);
      const ev = await recordVerification(tx, user, prep.docs[i].row, outs[i].result, b, "assembly");
      if (ev) events.push(ev);
    }
    const bad = outs.filter((o) => o.result.status === "TAMPERED").length;
    const asm = await writeAudit(tx, { actorId: user.id, action: "FOLDER_ASSEMBLED", caseId, basis: firstBasis,
      detail: `${prep.docs.length} document(s), ${bad} tampered, scope ${advocate ? "granted documents" : "full case"}` });
    const rows = (await tx.query(`${DOC_SELECT} WHERE d.id = ANY($1::uuid[]) ORDER BY d.created_at, d.id`, [prep.docs.map((d) => d.row.id)])).rows;
    return { rows, asmHash: asm.entryHash };
  });
  if (chain) {
    for (const e of events) void chain.auditEvent({ subject: { docId: e.docId, caseId: e.caseId }, action: "TAMPER_DETECTED", actorId: user.id, entryHash: e.entryHash, label: `TAMPER DETECTED in ${e.filename}: ${e.ranges}` });
    void chain.auditEvent({ subject: { caseId }, action: "FOLDER_ASSEMBLED", actorId: user.id, entryHash: saved.asmHash, label: `Case folder ${prep.firNo} assembled` });
  }

  const documents = saved.rows.map((r) => ({ document: toSummary(r), verification: outs[prep.docs.findIndex((d) => d.row.id === r.id)].result }));
  const totals = {
    documents: documents.length,
    parts: documents.reduce((n, d) => n + (d.verification.parts?.length ?? d.document.partCount), 0),
    partsVerified: documents.reduce((n, d) => n + (d.verification.parts?.filter((p) => p.status === "pass").length ?? 0), 0),
    tampered: documents.filter((d) => d.verification.status === "TAMPERED").length,
  };

  // 5. bundle only when everything is VERIFIED (and the folder matches what was sealed)
  // A damaged version that a restore has superseded stays visible in the report (incident history) but is not part of the bundle:
  // the bundle holds the CURRENT version of every document, and every one of those must be VERIFIED.
  const superseded = new Set(prep.docs.map((d) => d.row.parent_id as string | null).filter((x): x is string => !!x));
  const isCurrent = (id: string) => !superseded.has(id);
  const allVerified = documents.filter((d) => isCurrent(d.document.id)).every((d) => d.verification.status === "VERIFIED");
  const folderOk = !manifest || (manifest.root === manifest.recomputed && manifest.onChain !== "fail");
  let bundle: AssemblyReport["bundle"] = null;
  if (allVerified && folderOk && fitsInMemory && prep.docs.every((d, i) => !isCurrent(d.row.id) || outs[i].plaintext)) {
    const at = new Date();
    const entries: ZipEntry[] = [];
    const listing: Record<string, unknown>[] = [];
    for (let i = 0; i < prep.docs.length; i++) {
      const row = prep.docs[i].row;
      if (!isCurrent(row.id)) continue;
      let data = outs[i].plaintext!, name = row.filename as string, mark: string | null = null;
      if (advocate) {
        const b = await db.withUser(user.id, (tx) => basisFor(tx, user, row.id));
        const w = watermark({ bytes: data, filename: name, mimeType: row.mime_type, sha256: row.sha256 }, user.name, b.orderRef ?? "UNKNOWN", at);
        data = w.bytes; name = w.filename; mark = w.embedded ? "embedded" : "filename-only";
      }
      const entryName = `documents/${String(i + 1).padStart(2, "0")}_v${row.version}_${name}`;
      entries.push({ name: entryName, data, at });
      listing.push({ file: entryName, docId: row.id, type: row.type, version: row.version, sha256: row.sha256, chunkRoot: row.chunk_root, partRoot: row.part_root,
        signer: row.uploader_name, signerKeyHash: row.signer_key_hash, batchId: row.batch_id === null ? null : Number(row.batch_id), anchorTx: row.anchor_tx ?? null, watermark: mark });
    }
    const history = prep.docs.filter((d) => !isCurrent(d.row.id)).map((d) => ({ docId: d.row.id, version: d.row.version, sha256: d.row.sha256, note: "superseded by a later version; not included in this bundle" }));
    const manifestJson = JSON.stringify({ firNo: prep.firNo, caseId, assembledAt: at.toISOString(), assembledBy: user.name, scope: advocate ? "GRANTED_DOCUMENTS" : "FULL_CASE", manifest, documents: listing, supersededVersions: history }, null, 2);
    const cert = [
      "SAKSHYA — CASE FOLDER HASH CERTIFICATE", `FIR: ${prep.firNo}`, `Assembled: ${at.toISOString()} by ${user.name}`, "",
      `Every one of the ${listing.length} current document(s) below was decrypted and re-checked at the moment of assembly:`,
      "  - AES-256-GCM authenticated decryption of every stored part", "  - SHA-256 of the content and the 4 KiB chunk Merkle root against the signed original",
      "  - ML-DSA-65 signature, verified OFF-CHAIN by the Sakshya backend", "  - Merkle proof into an anchored batch whose root matches the root stored on the blockchain", "",
      "The blockchain stores hashes and the verifier's attestation; it does not itself verify post-quantum signatures.",
      manifest ? `Folder manifest v${manifest.version}: ${manifest.root} (recomputed ${manifest.recomputed}; on-chain check: ${manifest.onChain})` : "Folder manifest: not included for granted-document bundles.",
      history.length ? `${history.length} superseded version(s) are listed in manifest.json for the record and are not included as files.` : "",
      advocate ? "Granted copy: plain-text files carry a watermark inside the file; PDF/Word/image files are byte-identical and are marked by file name only." : "", "",
      ...listing.map((l) => `${l.file}\n  sha256 ${l.sha256}`),
    ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
    entries.push({ name: "manifest.json", data: Buffer.from(manifestJson), at }, { name: "CERTIFICATE.txt", data: Buffer.from(cert), at });
    const zip = buildZip(entries);
    const sha = createHash("sha256").update(zip).digest("hex");
    const put = putBundle({ userId: user.id, caseId, bytes: zip, sha256: sha, filename: `${prep.firNo.replace(/\//g, "_")}_folder.zip`, docIds: prep.docs.map((d) => d.row.id) });
    bundle = { downloadPath: `/api/cases/${caseId}/bundle?token=${put.token}`, sha256: sha, sizeBytes: zip.length, expiresAt: iso(put.expiresAt) };
  }
  return { caseId, assembledAt: new Date().toISOString(), scope: advocate ? "GRANTED_DOCUMENTS" : "FULL_CASE", manifest, totals, documents, bundle };
}

/** Releases an assembled bundle to the user it was made for, auditing a DOWNLOAD for every document inside it. */
export async function downloadBundle(user: SessionUser, caseId: string, token: string) {
  const b = getBundle(token, user.id, caseId);
  if (!b) { await logDenied(user.id, "bundle download refused: unknown, expired or foreign token", { caseId }); throw notFound("This bundle is no longer available; assemble the folder again"); }
  const db = await getDb();
  await db.withUser(user.id, async (tx) => {
    requireRows((await tx.query("SELECT id FROM cases WHERE id = $1", [caseId])).rows, "Case");
    for (const docId of b.docIds) {
      const basis = await basisFor(tx, user, docId); // an advocate's grant must still be live
      await writeAudit(tx, { actorId: user.id, action: "DOWNLOAD", docId, caseId, basis, detail: "included in case-folder bundle" });
    }
  });
  return b;
}
