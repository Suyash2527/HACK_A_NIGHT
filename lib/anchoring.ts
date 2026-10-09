// SERVER-ONLY batch anchoring. Documents that are not yet part of a batch are grouped into one Merkle tree; the batch root is
// signed by the SYSTEM ML-DSA-65 key (off-chain) and committed on-chain together with the signature hash and the audit-log head.
// Each document stores its Merkle proof, so verification later needs only: leaf → proof → root → root stored on-chain.
//
// Runs as the restricted `app_anchor` database role: it can fill anchor columns exactly once and nothing else.
import type { BatchSummary } from "@/types/api";
import { getChain, hex0x, type ChainService } from "./chain";
import { explorerFor } from "./chain-feed";
import { signCanonical, systemKeysFromEnv } from "./crypto/pqc";
import { getDb } from "./db";
import { forbidden } from "./errors";
import { pageOf, type PageArgs } from "./http";
import { buildTree, docLeaf, getProof, sha256Hex } from "./merkle";
import { isCourt } from "./policy";
import type { SessionUser } from "./session";

export const MAX_BATCH_DOCS = 500;
export interface AnchorResult { batchId: number; docCount: number; root: string; txHash: string | null; confirmed: boolean }
export interface AnchorDeps { chainService?: ChainService | null }

let running: Promise<unknown> = Promise.resolve();

/** Builds one batch from every unanchored document (or re-sends a batch whose transaction never confirmed) and anchors it on-chain. */
export function anchorPending(deps?: AnchorDeps): Promise<AnchorResult | null> {
  const job = running.then(() => anchorOnce(deps));
  running = job.catch(() => undefined);
  return job;
}

async function anchorOnce(deps?: AnchorDeps): Promise<AnchorResult | null> {
  const chain = deps && "chainService" in deps ? deps.chainService ?? null : await getChain();
  if (!chain) return null; // no blockchain configured: documents simply stay unanchored
  const db = await getDb();

  // 1. a batch that was built earlier but never got a confirmed transaction is retried first (same id, same root)
  let batch = await db.withAnchor(async (tx) => (await tx.query<{ id: string; root: string; doc_count: number; signature_hash: string }>(
    "SELECT id, root, doc_count, signature_hash FROM merkle_batches WHERE tx_hash IS NULL ORDER BY id LIMIT 1")).rows[0]);

  // 2. otherwise build a new batch
  if (!batch) {
    batch = await db.withAnchor(async (tx) => {
      const docs = (await tx.query<{ id: string; sha256: string; chunk_root: string; part_root: string }>(
        `SELECT id, sha256, chunk_root, part_root FROM documents WHERE batch_id IS NULL ORDER BY created_at, id LIMIT ${MAX_BATCH_DOCS}`)).rows;
      if (!docs.length) return undefined as never;
      const head = (await tx.query<{ seq: string; entry_hash: string }>("SELECT seq, entry_hash FROM audit_head()")).rows[0];
      const tree = buildTree(docs.map((d) => docLeaf(d.id, d.sha256, d.chunk_root, d.part_root)));
      const signed = signCanonical(
        { kind: "sakshya-batch", root: tree.root, docCount: docs.length, auditSeq: head ? Number(head.seq) : 0, auditHead: head?.entry_hash ?? "", at: new Date().toISOString() },
        systemKeysFromEnv().dsa.secretKey, "batch");
      const sigHash = sha256Hex(Buffer.from(signed.signature, "base64"));
      const row = (await tx.query<{ id: string }>(
        "INSERT INTO merkle_batches (root, doc_count, signature, signature_hash, audit_seq, audit_head) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
        [tree.root, docs.length, JSON.stringify({ canonical: signed.canonical, signature: signed.signature }), sigHash, head ? Number(head.seq) : null, head?.entry_hash ?? null])).rows[0];
      for (let i = 0; i < docs.length; i++) {
        const done = await tx.query("UPDATE documents SET batch_id = $1, merkle_proof = $2::jsonb WHERE id = $3 AND batch_id IS NULL", [row.id, JSON.stringify(getProof(tree, i)), docs[i].id]);
        if (done.rowCount !== 1) throw new Error("document could not be assigned to the batch");
      }
      return { id: row.id, root: tree.root, doc_count: docs.length, signature_hash: sigHash };
    });
    if (!batch) return null;
  }

  // 3. commit on-chain; resolves once the transaction is mined (or failed). Nothing here is on the request path.
  const batchId = Number(batch.id);
  const txHash = await chain.anchorBatch({ batchId, root: batch.root, signatureHash: batch.signature_hash, docCount: Number(batch.doc_count) });
  let confirmed = false;
  if (txHash) {
    confirmed = await db.withAnchor(async (tx) => {
      const st = (await tx.query<{ status: string }>("SELECT status FROM chain_txs WHERE tx_hash = $1", [txHash])).rows[0];
      if (st?.status !== "confirmed") return false;
      await tx.query("UPDATE merkle_batches SET tx_hash = $2, status = 'confirmed', anchored_at = now() WHERE id = $1", [batchId, txHash]);
      await tx.query("UPDATE documents SET anchor_tx = $2, anchored_at = now() WHERE batch_id = $1 AND anchor_tx IS NULL", [batchId, txHash]);
      return true;
    });
  }
  return { batchId, docCount: Number(batch.doc_count), root: batch.root, txHash, confirmed };
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** Debounced trigger used after uploads: many uploads in a short window become one batch. No-op when no chain is configured. */
export function scheduleAnchoring(delayMs = 20_000): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = undefined;
    anchorPending().catch((e) => console.error("[anchor] batch failed:", (e as Error).message));
  }, delayMs);
  timer.unref?.();
}

// ───────────────────────────── read side
export async function listBatches(user: SessionUser, a: PageArgs) {
  if (!isCourt(user.role)) throw forbidden("Only the court can inspect anchored batches");
  const db = await getDb();
  return db.withUser(user.id, async (tx) => {
    const rows = (await tx.query(
      `SELECT b.*, t.chain_id FROM merkle_batches b LEFT JOIN chain_txs t ON t.tx_hash = b.tx_hash ORDER BY b.id DESC LIMIT $1 OFFSET $2`, [a.limit + 1, a.offset])).rows;
    const items: BatchSummary[] = rows.slice(0, a.limit).map((r) => ({
      batchId: Number(r.id), root: hex0x(r.root), documentCount: Number(r.doc_count), status: r.status, txHash: r.tx_hash ?? null,
      explorerUrl: r.tx_hash && r.chain_id ? explorerFor(r.chain_id, r.tx_hash) : null, signatureHash: r.signature_hash,
      createdAt: new Date(r.created_at).toISOString(), anchoredAt: r.anchored_at ? new Date(r.anchored_at).toISOString() : null,
    }));
    return pageOf(items, rows.length > a.limit, a);
  });
}

