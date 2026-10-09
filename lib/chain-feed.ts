// SERVER-ONLY read side of the blockchain integration: the live transaction feed, explorer links and the on-chain root reader.
import { CHAINS, explorerTxUrl } from "../contracts/config/networks";
import type { ChainInfo, ChainTx, ChainTxKind } from "@/types/api";
import { getChain } from "./chain";
import { getDb, type Row, type Tx } from "./db";
import { pageArgs, toPage, type PageArgs } from "./http";
import type { SessionUser } from "./session";
import { unavailable } from "./errors";

const iso = (v: unknown) => new Date(v as string).toISOString();

/** Explorer link for a transaction on the chain it was sent to (null on the local dev chain). */
export function explorerFor(chainId: number | string, txHash: string | null): string | null {
  if (!txHash) return null;
  const profile = Object.values(CHAINS).find((p) => p.chainId === Number(chainId));
  return profile ? explorerTxUrl(profile, txHash) ?? null : null;
}

export function toChainTx(r: Row): ChainTx {
  return {
    id: r.id, kind: r.kind as ChainTxKind, txHash: r.tx_hash, explorerUrl: explorerFor(r.chain_id, r.tx_hash),
    status: r.status, blockNumber: r.block_number === null ? null : Number(r.block_number), docId: r.doc_id ?? null, caseId: r.case_id ?? null,
    label: r.label, at: iso(r.created_at), confirmedAt: r.confirmed_at ? iso(r.confirmed_at) : null,
  };
}

export async function listChainTxs(tx: Tx, filter: { docId?: string; caseId?: string }, a: PageArgs): Promise<{ items: ChainTx[]; nextCursor: string | null }> {
  const where: string[] = []; const params: unknown[] = [];
  if (filter.docId) { params.push(filter.docId); where.push(`doc_id = $${params.length}`); }
  if (filter.caseId) { params.push(filter.caseId); where.push(`case_id = $${params.length}`); }
  params.push(a.limit + 1, a.offset);
  const rows = (await tx.query(`SELECT * FROM chain_txs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, id LIMIT $${params.length - 1} OFFSET $${params.length}`, params)).rows;
  return toPage(rows.map(toChainTx), a);
}

export async function chainTransactions(user: SessionUser, url: URL, filter: { docId?: string; caseId?: string }) {
  const db = await getDb();
  return db.withUser(user.id, (tx) => listChainTxs(tx, filter, pageArgs(url)));
}

export async function chainInfo(): Promise<ChainInfo> {
  const chain = await getChain();
  if (!chain) throw unavailable("No blockchain is configured on this server");
  return chain.info();
}

/** Newest-first chain transactions for one document (for DocumentDetail.chain). */
export async function docChainTxs(user: SessionUser, docId: string, limit = 20): Promise<ChainTx[]> {
  const db = await getDb();
  return db.withUser(user.id, async (tx) => (await listChainTxs(tx, { docId }, { limit, offset: 0 })).items);
}
