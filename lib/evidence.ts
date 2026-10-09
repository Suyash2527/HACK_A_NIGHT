// SERVER-ONLY evidence service: upload (seal → store → sign → audit → manifest), verify (six checks), view, restore.
// Routes stay thin; every rule lives here and is covered by tests/evidence.test.ts.
import { randomUUID } from "node:crypto";
import {
  ALLOWED_UPLOAD_MIME, MAX_UPLOAD_BYTES, STORAGE_PART_BYTES,
  type Accessor, type AllowedMime, type AuditAction, type CheckStatus, type DocType, type DocumentDetail, type DocumentSummary,
  type LegalBasis, type PartCheck, type Role, type ScanDetail, type UploadReceipt, type VerifyResult, type VerifyStatus,
} from "@/types/api";
import { courtOrderBasis, defaultBasis, logDenied, systemBasis, writeAudit } from "./audit";
import { deriveUserDsaKeys, canonicalJson, signDocument, systemKeysFromEnv, verifyCanonical, type DocPayload, type WrappedDek } from "./crypto/pqc";
import { openDocument, sealDocument } from "./crypto/parts";
import { scheduleAnchoring } from "./anchoring";
import { getChain, type ChainService } from "./chain";
import { getDb, type Row, type Tx } from "./db";
import { forbidden, invalid, notFound, requireRows, tampered, tooLarge } from "./errors";
import { buildChunkTree, buildManifest, docLeaf, localizeTamper, sha256Hex, verifyProof } from "./merkle";
import { canRestoreDoc, canRunScan, requireUploadType } from "./policy";
import type { SessionUser } from "./session";
import { getPartStore, type PartStore } from "./storage/part-store";

// ───────────────────────────── helpers
const dsaSeed = () => {
  const s = process.env.PQC_DSA_SEED;
  if (!s) throw new Error("PQC_DSA_SEED is not set");
  return s;
};
export const userKeys = (userId: string) => deriveUserDsaKeys(dsaSeed(), userId);
export const keyHash = (publicKey: Uint8Array) => sha256Hex(publicKey);

/** Injected so tests and the chain module can plug in; returns the root stored on-chain for a batch (plain hex) or null. */
export type ChainReader = (batchId: number) => Promise<string | null>;
export interface EvidenceDeps { store?: PartStore; chain?: ChainReader; chainService?: ChainService | null }
/** The blockchain service, or null when no chain is configured (every chain call is then skipped). */
const chainOf = async (d?: EvidenceDeps): Promise<ChainService | null> => (d && "chainService" in d ? d.chainService ?? null : await getChain());
const storeOf = (d?: EvidenceDeps) => d?.store ?? getPartStore();
/** On-chain batch-root reader: injected in tests, otherwise the live chain service (undefined when no chain is configured). */
const readerOf = async (d?: EvidenceDeps): Promise<ChainReader | undefined> => {
  if (d?.chain) return d.chain;
  const c = await chainOf(d);
  return c ? (id) => c.batchRoot(id) : undefined;
};

const iso = (v: unknown) => new Date(v as string).toISOString();
const SAFE_NAME = /[^A-Za-z0-9._ -]/g;
export const cleanFilename = (n: string) => n.replace(SAFE_NAME, "_").replace(/^\.+/, "").slice(0, 120) || "document";

const DOC_SELECT = `
  SELECT d.id, d.case_id, d.type, d.version, d.parent_id, d.filename, d.mime_type, d.size_bytes, d.uploader_id, d.sha256, d.chunk_root,
         d.chunk_leaves, d.part_root, d.part_count, d.wrapped_dek, d.signature, d.signed_payload, d.signer_key_hash, d.created_at,
         d.batch_id, d.merkle_proof, d.anchor_tx, u.name AS uploader_name, u.role AS uploader_role,
         jsonb_array_length(d.chunk_leaves) AS chunk_count,
         (SELECT v.status FROM verification_results v WHERE v.doc_id = d.id ORDER BY v.at DESC, v.id DESC LIMIT 1) AS vstatus,
         (SELECT v.at FROM verification_results v WHERE v.doc_id = d.id ORDER BY v.at DESC, v.id DESC LIMIT 1) AS vat
  FROM documents d JOIN users u ON u.id = d.uploader_id`;

export function toSummary(r: Row): DocumentSummary {
  return {
    id: r.id, caseId: r.case_id, filename: r.filename, type: r.type, version: Number(r.version), parentId: r.parent_id ?? null,
    sizeBytes: Number(r.size_bytes), mimeType: r.mime_type as AllowedMime, uploaderName: r.uploader_name, createdAt: iso(r.created_at),
    sha256: r.sha256, chunkRoot: r.chunk_root, chunkCount: Number(r.chunk_count), partCount: Number(r.part_count),
    verificationStatus: (r.vstatus as VerifyStatus | null) ?? null, verifiedAt: r.vat ? iso(r.vat) : null,
  };
}

/** Legal basis for touching a document: court-order basis for advocates (from their live grant), role default otherwise. */
export async function basisFor(tx: Tx, user: SessionUser, docId: string): Promise<LegalBasis> {
  if (user.role !== "DEFENCE_ADVOCATE") return defaultBasis(user.role);
  const g = (await tx.query<{ order_ref: string; citation: string }>(
    `SELECT g.order_ref, coalesce(r.legal_basis->>'citation','') AS citation
       FROM request_grants g JOIN document_requests r ON r.id = g.request_id
      WHERE g.document_id = $1 AND g.user_id = app_uid() AND (g.expires_at IS NULL OR g.expires_at > now())
      ORDER BY g.expires_at DESC NULLS FIRST LIMIT 1`, [docId])).rows[0];
  if (!g) throw forbidden("No active court order covers this document");
  return courtOrderBasis(g.citation, g.order_ref);
}

// ───────────────────────────── upload
export interface UploadInput {
  caseId: string; type: DocType; filename: string; mimeType: string; bytes: Uint8Array;
  parentId?: string | null; auditAction?: Extract<AuditAction, "UPLOAD" | "RESTORE">; auditDetail?: string;
}

export function validateFile(filename: string, mimeType: string, size: number): AllowedMime {
  if (size === 0) throw invalid("The file is empty");
  if (size > MAX_UPLOAD_BYTES) throw tooLarge();
  if (!(mimeType in ALLOWED_UPLOAD_MIME)) throw invalid(`File type ${mimeType || "unknown"} is not allowed`, { allowed: Object.values(ALLOWED_UPLOAD_MIME) });
  const ext = Object.entries(ALLOWED_UPLOAD_MIME).find(([m]) => m === mimeType)![1];
  if (!filename.toLowerCase().endsWith(ext) && !(ext === ".jpg" && filename.toLowerCase().endsWith(".jpeg")))
    throw invalid(`File name must end with ${ext}`);
  return mimeType as AllowedMime;
}

export async function uploadDocument(user: SessionUser, input: UploadInput, deps?: EvidenceDeps): Promise<UploadReceipt> {
  requireUploadType(user.role, input.type);
  const mime = validateFile(input.filename, input.mimeType, input.bytes.length);
  const db = await getDb();
  const store = storeOf(deps);

  // 1. authorise + resolve version lineage (RLS: the case must be visible AND the user assigned — checked again on INSERT)
  const parent = await db.withUser(user.id, async (tx) => {
    const c = (await tx.query("SELECT id FROM cases WHERE id = $1", [input.caseId])).rows;
    if (!c.length) { throw notFound("Case unavailable"); }
    if (!input.parentId) return null;
    const p = (await tx.query("SELECT id, case_id, version FROM documents WHERE id = $1", [input.parentId])).rows[0];
    if (!p || p.case_id !== input.caseId) throw invalid("The document being corrected was not found in this case");
    return { id: p.id as string, version: Number(p.version) };
  }).catch(async (e) => { await logDenied(user.id, `upload refused: ${(e as Error).message}`, { caseId: input.caseId }); throw e; });

  // 2. fingerprint, seal (encrypt in parts, wrap key), sign
  const docId = randomUUID();
  const version = parent ? parent.version + 1 : 1;
  const bytes = Buffer.from(input.bytes);
  const keys = systemKeysFromEnv();
  const chunks = buildChunkTree(bytes);
  const sealed = sealDocument(bytes, keys.kem.publicKey, docId);
  const signer = userKeys(user.id);
  const payload: DocPayload = {
    docId, caseId: input.caseId, docType: input.type, version, sha256: sealed.sha256,
    chunkRoot: chunks.root, partRoot: sealed.partRoot, timestamp: new Date().toISOString(),
  };
  const signed = signDocument(payload, signer.secretKey);

  // 3. store ciphertext parts (content-addressed: re-putting identical bytes is harmless if the DB step fails)
  await Promise.all(sealed.parts.map((p) => store.put(p.object)));

  // 4. one transaction: document, parts, audit, case manifest
  const filename = cleanFilename(input.filename);
  const result = await db.withUser(user.id, async (tx) => {
    await tx.query(
      `INSERT INTO documents (id, case_id, type, version, parent_id, filename, mime_type, size_bytes, uploader_id, sha256, chunk_root, chunk_leaves,
                              part_root, part_count, wrapped_dek, signature, signed_payload, signer_key_hash)
       VALUES ($1,$2,$3::doc_type,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15::jsonb,$16,$17,$18)`,
      [docId, input.caseId, input.type, version, parent?.id ?? null, filename, mime, bytes.length, user.id, sealed.sha256, chunks.root,
       JSON.stringify(chunks.leaves), sealed.partRoot, sealed.parts.length, JSON.stringify(sealed.wrappedDek), signed.signature, signed.canonical, keyHash(signer.publicKey)],
    );
    for (const p of sealed.parts)
      await tx.query("INSERT INTO document_parts (doc_id, idx, address, size) VALUES ($1,$2,$3,$4)", [docId, p.index, p.address, p.object.length]);

    const basis = defaultBasis(user.role);
    const audit = await writeAudit(tx, { actorId: user.id, action: input.auditAction ?? "UPLOAD", docId, caseId: input.caseId, basis, detail: input.auditDetail ?? `${input.type} v${version}` });
    const manifest = await sealManifest(tx, user, input.caseId, basis);
    const row = (await tx.query(`${DOC_SELECT} WHERE d.id = $1`, [docId])).rows[0];
    const firNo = (await tx.query<{ fir_no: string }>("SELECT fir_no FROM cases WHERE id = $1", [input.caseId])).rows[0].fir_no;
    return { audit, row, manifest, firNo };
  });

  // 5. blockchain (fire-and-forget: the response never waits for a block). The signature was verified off-chain by this backend
  //    just now, so the verifier attests "valid" with a hash of the evidence; the chain does not verify the PQ signature itself.
  const chain = await chainOf(deps);
  if (chain) {
    scheduleAnchoring(); // batches everything uploaded in the next few seconds into one Merkle root
    const evidence = canonicalJson({ docId, alg: "ML-DSA-65", signatureHash: sha256Hex(Buffer.from(signed.signature, "base64")), publicKeyHash: keyHash(signer.publicKey), result: "valid" });
    void chain.registerRecord({ docId, caseId: input.caseId, filename, version, parentDocId: parent?.id ?? null, sha256: sealed.sha256, chunkRoot: chunks.root,
      signatureB64: signed.signature, signerKeyHash: keyHash(signer.publicKey) });
    void chain.attestSignature({ docId, caseId: input.caseId, filename, valid: true, evidence });
    if (result.manifest) void chain.sealCaseManifest({ caseId: input.caseId, firNo: result.firNo, ...result.manifest });
    if (input.auditAction === "RESTORE")
      void chain.auditEvent({ subject: { docId, caseId: input.caseId }, action: "RESTORE", actorId: user.id, entryHash: result.audit.entryHash, label: `Restore recorded for ${filename} v${version}` });
  }

  const verification: VerifyResult = {
    status: "UNANCHORED",
    checks: { decrypt: "pass", plaintextHash: "pass", chunkRoot: "pass", signature: "pass", merkleProof: "skip", onChainRoot: "skip" },
    tamperRanges: [], lastAccessors: [], originalVersionAvailable: true,
  };
  return {
    document: toSummary(result.row), encryption: "AES-256-GCM", keyWrapping: "ML-KEM-768",
    signature: { algorithm: "ML-DSA-65", status: "pass" }, auditEntryId: result.audit.id, verification,
  };
}

/** Seals the next case-manifest version over every document in the case, in creation order. */
export async function sealManifest(tx: Tx, user: SessionUser, caseId: string, basis: LegalBasis) {
  const docs = (await tx.query<Row>("SELECT id, sha256, chunk_root, part_root FROM documents WHERE case_id = $1 ORDER BY created_at, id", [caseId])).rows;
  if (!docs.length) return null;
  const tree = buildManifest(docs.map((d) => docLeaf(d.id, d.sha256, d.chunk_root, d.part_root)));
  const version = Number((await tx.query("SELECT coalesce(max(version),0) + 1 AS v FROM case_manifests WHERE case_id = $1", [caseId])).rows[0].v);
  await tx.query("INSERT INTO case_manifests (case_id, version, root, doc_count) VALUES ($1,$2,$3,$4)", [caseId, version, tree.root, docs.length]);
  await writeAudit(tx, { actorId: user.id, action: "MANIFEST_SEALED", caseId, basis, detail: `manifest v${version}, ${docs.length} document(s)` });
  return { version, root: tree.root, documentCount: docs.length };
}

// ───────────────────────────── verification
interface LoadedDoc { row: Row; addresses: string[] }

async function loadDoc(tx: Tx, docId: string): Promise<LoadedDoc> {
  const row = (await tx.query(`${DOC_SELECT} WHERE d.id = $1`, [docId])).rows[0];
  if (!row) throw notFound("Document unavailable");
  const parts = (await tx.query<{ address: string }>("SELECT address FROM document_parts WHERE doc_id = $1 ORDER BY idx", [docId])).rows;
  return { row, addresses: parts.map((p) => p.address) };
}

export function statusFrom(checks: VerifyResult["checks"], partsOk: boolean, anchored: boolean): VerifyStatus {
  const contentFailed = [checks.decrypt, checks.plaintextHash, checks.chunkRoot, checks.signature].includes("fail") || !partsOk;
  if (contentFailed) return "TAMPERED";
  if (checks.merkleProof === "fail" || checks.onChainRoot === "fail") return "TAMPERED";
  if (!anchored) return "UNANCHORED";
  return checks.merkleProof === "pass" && checks.onChainRoot === "pass" ? "VERIFIED" : "PENDING_ANCHOR";
}

export interface VerifyOutcome { result: VerifyResult; plaintext: Buffer | null }

/** Pure verification of one loaded document against storage. Never throws for tampering — reports it. */
export async function verifyLoaded(l: LoadedDoc, store: PartStore, chain?: ChainReader): Promise<VerifyOutcome> {
  const { row, addresses } = l;
  const keys = systemKeysFromEnv();
  const objects = await Promise.all(addresses.map((a) => store.get(a)));
  const opened = openDocument(objects, addresses, row.wrapped_dek as WrappedDek, keys.kem.secretKey, row.id);

  const diag = opened.diagnosticPlaintext;
  const size = Number(row.size_bytes);
  const parts: PartCheck[] = opened.parts.map((p) => ({
    index: p.index, byteStart: p.index * STORAGE_PART_BYTES,
    byteEnd: Math.max(p.index * STORAGE_PART_BYTES, Math.min(size, (p.index + 1) * STORAGE_PART_BYTES) - 1),
    address: p.address, status: p.state === "ok" ? "pass" : "fail",
  }));

  const checks: VerifyResult["checks"] = { decrypt: "fail", plaintextHash: "skip", chunkRoot: "skip", signature: "fail", merkleProof: "skip", onChainRoot: "skip" };
  let tamperRanges: VerifyResult["tamperRanges"] = [];
  if (diag) {
    checks.decrypt = "pass";
    checks.plaintextHash = sha256Hex(diag) === row.sha256 ? "pass" : "fail";
    const tree = buildChunkTree(diag);
    checks.chunkRoot = tree.root === row.chunk_root && diag.length === size ? "pass" : "fail";
    if (checks.chunkRoot === "fail") tamperRanges = localizeTamper(row.chunk_leaves as string[], diag, tree.chunkSize, size);
  }

  // signature: the signed payload must match the database columns AND verify under the uploader's ML-DSA-65 key
  try {
    const signed = JSON.parse(row.signed_payload) as DocPayload;
    const bound = signed.docId === row.id && signed.caseId === row.case_id && signed.docType === row.type && signed.version === Number(row.version) &&
      signed.sha256 === row.sha256 && signed.chunkRoot === row.chunk_root && signed.partRoot === row.part_root && canonicalJson(signed) === row.signed_payload;
    const pub = userKeys(row.uploader_id).publicKey;
    checks.signature = bound && keyHash(pub) === row.signer_key_hash && verifyCanonical(row.signed_payload, row.signature, pub, "document") ? "pass" : "fail";
  } catch { checks.signature = "fail"; }

  // anchoring: document leaf ∈ batch root, and batch root equals the root on-chain
  const anchored = row.batch_id !== null && row.merkle_proof !== null;
  let anchor: VerifyResult["anchor"];
  if (anchored) {
    const proof = row.merkle_proof as { root: string; leaf: string; proof: string[] };
    const leaf = docLeaf(row.id, row.sha256, row.chunk_root, row.part_root); // always recomputed server-side
    checks.merkleProof = proof.leaf === leaf && verifyProof(proof.proof, leaf, proof.root) ? "pass" : "fail";
    const onChain = chain ? await chain(Number(row.batch_id)).catch(() => null) : null;
    checks.onChainRoot = onChain === null ? "skip" : onChain === proof.root ? "pass" : "fail";
    if (row.anchor_tx) anchor = { batchId: Number(row.batch_id), root: `0x${proof.root}`, txHash: row.anchor_tx, explorerUrl: null, status: checks.onChainRoot === "pass" ? "confirmed" : "pending" };
  }

  const retained = await Promise.all(addresses.map((a) => store.getOriginal(a)));
  const result: VerifyResult = {
    status: statusFrom(checks, opened.allPartsOk, anchored), checks, tamperRanges, parts, ...(anchor ? { anchor } : {}),
    lastAccessors: [], originalVersionAvailable: retained.every((b) => b !== null),
  };
  return { result, plaintext: opened.plaintext };
}

async function accessors(tx: Tx, docId: string): Promise<Accessor[]> {
  const rows = (await tx.query<Row>(
    `SELECT u.name, u.role, a.action, a.at FROM audit_log a JOIN users u ON u.id = a.actor_id
      WHERE a.doc_id = $1 AND a.action IN ('UPLOAD','VIEW','DOWNLOAD','VERIFY','RESTORE') ORDER BY a.seq DESC LIMIT 6`, [docId])).rows;
  return rows.map((r) => ({ actorName: r.name, role: r.role as Role, action: r.action, at: iso(r.at) }));
}

/** Verifies, records the result and audits it (VERIFY, or TAMPER_DETECTED when it fails). */
export async function verifyDocumentById(user: SessionUser, docId: string, deps?: EvidenceDeps): Promise<VerifyResult> {
  const db = await getDb();
  const store = storeOf(deps);
  const loaded = await db.withUser(user.id, (tx) => loadDoc(tx, docId)).catch(async (e) => {
    await logDenied(user.id, "verification refused: document not accessible", { docId });
    throw e;
  });
  const { result } = await verifyLoaded(loaded, store, await readerOf(deps));
  const explorer = await chainOf(deps);
  if (result.anchor && explorer) result.anchor.explorerUrl = explorer.explorerUrl(result.anchor.txHash);
  return db.withUser(user.id, async (tx) => {
    result.lastAccessors = await accessors(tx, docId);
    const basis = await basisFor(tx, user, docId);
    await tx.query("INSERT INTO verification_results (doc_id, status, result, checked_by) VALUES ($1,$2,$3::jsonb,$4)", [docId, result.status, JSON.stringify(result), user.id]);
    const bad = result.status === "TAMPERED";
    const entry = await writeAudit(tx, { actorId: user.id, action: bad ? "TAMPER_DETECTED" : "VERIFY", docId, caseId: loaded.row.case_id, basis,
      detail: bad ? `tampered: ${result.tamperRanges.map((r) => `chunk ${r.chunkIndex} [${r.byteStart}-${r.byteEnd}]`).join(", ") || "part/hash mismatch"}` : result.status });
    return { result, entry, bad };
  }).then(async ({ result, entry, bad }) => {
    // a detected tamper is itself written to the public chain, so the finding cannot be quietly deleted later
    const chain = await chainOf(deps);
    if (bad && chain) void chain.auditEvent({ subject: { docId, caseId: loaded.row.case_id }, action: "TAMPER_DETECTED", actorId: user.id, entryHash: entry.entryHash,
      label: `TAMPER DETECTED in ${loaded.row.filename}: ${result.tamperRanges.map((r) => `chunk ${r.chunkIndex}`).join(", ") || "part mismatch"}` });
    return result;
  });
}

// ───────────────────────────── view / download
export interface ContentResult { bytes: Buffer; filename: string; mimeType: string; sha256: string; verification: VerifyResult; orderRef: string | null }

/** Verifies FIRST, then releases plaintext. A tampered or unverifiable document is never served. */
export async function readContent(user: SessionUser, docId: string, disposition: "inline" | "attachment", deps?: EvidenceDeps): Promise<ContentResult> {
  const db = await getDb();
  const store = storeOf(deps);
  const loaded = await db.withUser(user.id, (tx) => loadDoc(tx, docId)).catch(async (e) => {
    await logDenied(user.id, `${disposition === "inline" ? "view" : "download"} refused: document not accessible`, { docId });
    throw e;
  });
  const out = await verifyLoaded(loaded, store, await readerOf(deps));
  return db.withUser(user.id, async (tx) => {
    out.result.lastAccessors = await accessors(tx, docId);
    const basis = await basisFor(tx, user, docId);
    await tx.query("INSERT INTO verification_results (doc_id, status, result, checked_by) VALUES ($1,$2,$3::jsonb,$4)", [docId, out.result.status, JSON.stringify(out.result), user.id]);
    if (!out.plaintext || out.result.status === "TAMPERED") {
      await writeAudit(tx, { actorId: user.id, action: "TAMPER_DETECTED", docId, caseId: loaded.row.case_id, basis, detail: "content withheld: integrity mismatch" });
      throw tampered("Integrity mismatch: content withheld", { verification: out.result as unknown as Record<string, unknown> });
    }
    await writeAudit(tx, { actorId: user.id, action: disposition === "inline" ? "VIEW" : "DOWNLOAD", docId, caseId: loaded.row.case_id, basis });
    return { bytes: out.plaintext, filename: loaded.row.filename, mimeType: loaded.row.mime_type, sha256: loaded.row.sha256, verification: out.result, orderRef: basis.orderRef };
  });
}

// ───────────────────────────── restore (append a new version from the retained original)
export async function restoreDocument(user: SessionUser, docId: string, reason: string, deps?: EvidenceDeps): Promise<UploadReceipt> {
  if (!reason || reason.trim().length < 5) throw invalid("A reason for the restore is required");
  const db = await getDb();
  const store = storeOf(deps);
  const loaded = await db.withUser(user.id, (tx) => loadDoc(tx, docId));
  const { row, addresses } = loaded;
  if (!canRestoreDoc(user.role, row.uploader_role as Role, row.type as DocType)) {
    await logDenied(user.id, "restore refused: only the original contributor's role may restore", { docId, caseId: row.case_id });
    throw forbidden("Only an authorised contributor of this document type may restore it");
  }
  const originals = await Promise.all(addresses.map((a) => store.getOriginal(a)));
  if (originals.some((o) => o === null)) throw notFound("The retained original is not available");
  const opened = openDocument(originals, addresses, row.wrapped_dek as WrappedDek, systemKeysFromEnv().kem.secretKey, row.id);
  if (!opened.plaintext || sha256Hex(opened.plaintext) !== row.sha256) throw tampered("The retained original does not match the signed hash");
  return uploadDocument(user, {
    caseId: row.case_id, type: row.type, filename: row.filename, mimeType: row.mime_type, bytes: opened.plaintext,
    parentId: row.id, auditAction: "RESTORE", auditDetail: `restored from retained original of ${row.id}: ${reason.trim().slice(0, 200)}`,
  }, deps);
}

// ───────────────────────────── integrity scans (court roles; synchronous)
export const MAX_SCAN_DOCS = 150;
const SCAN_CONCURRENCY = 6;

export async function runIntegrityScan(user: SessionUser, caseId?: string, deps?: EvidenceDeps): Promise<ScanDetail> {
  if (!canRunScan(user.role)) {
    await logDenied(user.id, "integrity scan refused: court roles only");
    throw forbidden("Only the court can run integrity scans");
  }
  const db = await getDb();
  const store = storeOf(deps);
  const reader = await readerOf(deps);
  const startedAt = new Date();

  const loaded = await db.withUser(user.id, async (tx) => {
    if (caseId) requireRows((await tx.query("SELECT id FROM cases WHERE id = $1", [caseId])).rows, "Case");
    const ids = (await tx.query<{ id: string }>(`SELECT id FROM documents ${caseId ? "WHERE case_id = $1" : ""} ORDER BY created_at, id LIMIT ${MAX_SCAN_DOCS + 1}`, caseId ? [caseId] : [])).rows;
    if (ids.length > MAX_SCAN_DOCS) throw invalid(`A scan covers at most ${MAX_SCAN_DOCS} documents; scan one case at a time`);
    const out: LoadedDoc[] = [];
    for (const { id } of ids) out.push(await loadDoc(tx, id));
    return out;
  });

  // fetch + verify outside any transaction, a few documents at a time
  const outcomes: VerifyResult[] = new Array(loaded.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, loaded.length) }, async () => {
    for (let i = next++; i < loaded.length; i = next++) outcomes[i] = (await verifyLoaded(loaded[i], store, reader)).result;
  }));

  const saved = await db.withUser(user.id, async (tx) => {
    const basis = defaultBasis(user.role);
    const events: { docId: string; caseId: string; filename: string; entryHash: string; ranges: string }[] = [];
    for (let i = 0; i < loaded.length; i++) {
      const row = loaded[i].row, result = outcomes[i];
      result.lastAccessors = await accessors(tx, row.id);
      await tx.query("INSERT INTO verification_results (doc_id, status, result, checked_by) VALUES ($1,$2,$3::jsonb,$4)", [row.id, result.status, JSON.stringify(result), user.id]);
      if (result.status === "TAMPERED") {
        const ranges = result.tamperRanges.map((r) => `chunk ${r.chunkIndex}`).join(", ") || "part mismatch";
        const e = await writeAudit(tx, { actorId: user.id, action: "TAMPER_DETECTED", docId: row.id, caseId: row.case_id, basis,
          detail: `scan: tampered: ${result.tamperRanges.map((r) => `chunk ${r.chunkIndex} [${r.byteStart}-${r.byteEnd}]`).join(", ") || "part/hash mismatch"}` });
        events.push({ docId: row.id, caseId: row.case_id, filename: row.filename, entryHash: e.entryHash, ranges });
      }
    }
    const tamperedCount = outcomes.filter((o) => o.status === "TAMPERED").length;
    await writeAudit(tx, { actorId: user.id, action: "SCAN", caseId: caseId ?? null, basis: systemBasis(), detail: `scanned ${loaded.length} document(s): ${tamperedCount} tampered` });
    const rec = (await tx.query<{ id: string }>(
      "INSERT INTO integrity_scans (requested_by, case_id, total, started_at, results) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING id",
      [user.id, caseId ?? null, loaded.length, startedAt.toISOString(), JSON.stringify(loaded.map((l, i) => ({ docId: l.row.id, verification: outcomes[i] })))])).rows[0];
    return { id: rec.id, events };
  });

  const chain = await chainOf(deps);
  if (chain) for (const e of saved.events)
    void chain.auditEvent({ subject: { docId: e.docId, caseId: e.caseId }, action: "TAMPER_DETECTED", actorId: user.id, entryHash: e.entryHash, label: `TAMPER DETECTED in ${e.filename}: ${e.ranges}` });
  return getIntegrityScan(user, saved.id);
}

export async function getIntegrityScan(user: SessionUser, scanId: string): Promise<ScanDetail> {
  if (!canRunScan(user.role)) { await logDenied(user.id, "integrity scan results refused: court roles only"); throw forbidden("Only the court can read integrity scans"); }
  const db = await getDb();
  return db.withUser(user.id, async (tx) => {
    const s = requireRows((await tx.query("SELECT * FROM integrity_scans WHERE id = $1", [scanId])).rows, "Scan")[0];
    const stored = s.results as { docId: string; verification: VerifyResult }[];
    const ids = stored.map((r) => r.docId);
    const rows = ids.length ? (await tx.query(`${DOC_SELECT} WHERE d.id = ANY($1::uuid[])`, [ids])).rows : [];
    const byId = new Map(rows.map((r) => [r.id as string, r]));
    return {
      id: s.id, status: "completed", checked: stored.length, total: Number(s.total), startedAt: iso(s.started_at), completedAt: iso(s.completed_at),
      results: stored.filter((r) => byId.has(r.docId)).map((r) => ({ document: toSummary(byId.get(r.docId)!), verification: r.verification })),
    } satisfies ScanDetail;
  });
}

// ───────────────────────────── queries for routes
export async function listCaseDocuments(user: SessionUser, caseId: string): Promise<DocumentSummary[]> {
  const db = await getDb();
  return db.withUser(user.id, async (tx) => {
    requireRows((await tx.query("SELECT id FROM cases WHERE id = $1", [caseId])).rows, "Case");
    return (await tx.query(`${DOC_SELECT} WHERE d.case_id = $1 ORDER BY d.created_at, d.id`, [caseId])).rows.map(toSummary);
  });
}

export async function getDocumentDetail(user: SessionUser, docId: string): Promise<DocumentDetail> {
  const db = await getDb();
  return db.withUser(user.id, async (tx) => {
    const row = (await tx.query(`${DOC_SELECT} WHERE d.id = $1`, [docId])).rows[0];
    if (!row) throw notFound("Document unavailable");
    const all = (await tx.query(`${DOC_SELECT} WHERE d.case_id = $1 ORDER BY d.created_at, d.id`, [row.case_id])).rows;
    const byId = new Map(all.map((r) => [r.id as string, r]));
    // lineage = ancestors + descendants of this document
    const chain = new Set<string>([row.id]);
    for (let p = row.parent_id; p && byId.has(p); p = byId.get(p)!.parent_id) chain.add(p);
    let grew = true;
    while (grew) { grew = false; for (const r of all) if (r.parent_id && chain.has(r.parent_id) && !chain.has(r.id)) { chain.add(r.id); grew = true; } }
    const access = user.role === "DEFENCE_ADVOCATE"
      ? await (async () => {
          const g = (await tx.query<Row>("SELECT request_id, order_ref, expires_at FROM request_grants WHERE document_id = $1 AND user_id = app_uid() AND (expires_at IS NULL OR expires_at > now()) LIMIT 1", [docId])).rows[0];
          return g ? ({ via: "GRANT", requestId: g.request_id, orderRef: g.order_ref, expiresAt: g.expires_at ? iso(g.expires_at) : null } as const) : ({ via: "ROLE" } as const);
        })()
      : ({ via: "ROLE" } as const);
    const summary = toSummary(row);
    const readable = user.role !== "COMPLAINANT";
    return {
      ...summary, versions: all.filter((r) => chain.has(r.id)).map(toSummary),
      signature: { algorithm: "ML-DSA-65", signerName: row.uploader_name, publicKeyHash: row.signer_key_hash },
      canPreview: readable && row.mime_type !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      canDownload: readable, canAddVersion: canRestoreDoc(user.role, row.uploader_role, row.type), canRestore: canRestoreDoc(user.role, row.uploader_role, row.type) && row.vstatus === "TAMPERED",
      access,
    };
  });
}

export type { CheckStatus };
