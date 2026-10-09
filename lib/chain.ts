// SERVER-ONLY blockchain service: turns what happens in Sakshya into REAL on-chain transactions on SakshyaRegistry
// (Sepolia for the live demo, a local Hardhat node for development). Only commitments go on-chain: hashes, version numbers and
// pseudonymous actor hashes — never plaintext, keys, signatures or personal data.
//
// Design rules:
//  • The request path NEVER waits for a block. Jobs run in a serial queue (one nonce at a time); a tx is stored as "submitted" the
//    moment it is broadcast and flipped to "confirmed" when its receipt arrives. A chain outage cannot break an upload.
//  • If no registry address / signer is configured the service is disabled and every call is a harmless no-op.
import { createHash } from "node:crypto";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { CHAINS, assertChainId, assertMainnetAllowed, explorerTxUrl, type ChainProfile } from "../contracts/config/networks";
import type { ChainInfo, ChainTx, ChainTxKind } from "@/types/api";
import { getDb } from "./db";
import { REGISTRY_ABI } from "./chain-abi";

const sha = (s: string) => `0x${createHash("sha256").update(s, "utf8").digest("hex")}`;
export const recordIdFor = (docId: string) => sha(`qs:doc:${docId}`);
export const caseRefFor = (caseId: string) => sha(`qs:case:${caseId}`);
export const actorHashFor = (userId: string, salt = process.env.ACTOR_HASH_SALT ?? "") => sha(`${userId}|${salt}`);
export const hex0x = (h: string) => (h.startsWith("0x") ? h : `0x${h}`);

/** Audit actions as numbered in SakshyaRegistry.AuditAction (and types/api.ts AUDIT_ACTIONS). */
const ACTION_INDEX: Record<string, number> = { UPLOAD: 0, VIEW: 1, DOWNLOAD: 2, VERIFY: 3, DENIED: 4, ANCHOR: 5, SCAN: 6, TAMPER_DETECTED: 7, RESTORE: 8,
  REQUEST_FILED: 9, REQUEST_GRANTED: 10, REQUEST_REJECTED: 11, FOLDER_ASSEMBLED: 12, MILESTONE_ADDED: 13, MANIFEST_SEALED: 14 };

// ───────────────────────────── transaction store (DB-backed "live feed")
export interface TxRow { kind: ChainTxKind; txHash: string; chainId: number; docId?: string | null; caseId?: string | null; label: string }
export interface TxStore {
  insert(row: TxRow): Promise<void>;
  setStatus(txHash: string, status: "confirmed" | "failed", blockNumber?: number, error?: string): Promise<void>;
}
export const dbTxStore: TxStore = {
  async insert(r) {
    const db = await getDb();
    await db.withAnchor((tx) => tx.query("INSERT INTO chain_txs (kind, tx_hash, chain_id, doc_id, case_id, label) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tx_hash) DO NOTHING",
      [r.kind, r.txHash, r.chainId, r.docId ?? null, r.caseId ?? null, r.label]));
  },
  async setStatus(txHash, status, blockNumber, error) {
    const db = await getDb();
    await db.withAnchor((tx) => tx.query("UPDATE chain_txs SET status = $2, block_number = $3, error = $4, confirmed_at = CASE WHEN $2 = 'confirmed' THEN now() END WHERE tx_hash = $1",
      [txHash, status, blockNumber ?? null, error?.slice(0, 300) ?? null]));
  },
};

// ───────────────────────────── service
export interface RegistryLike {
  registerRecord(recordId: string, input: Record<string, unknown>): Promise<TxLike>;
  attestSignature(recordId: string, verdict: number, evidenceHash: string): Promise<TxLike>;
  sealCaseManifest(caseRef: string, version: number, root: string, count: number): Promise<TxLike>;
  logAuditEvent(subjectId: string, action: number, actorHash: string, eventHash: string): Promise<TxLike>;
  anchorBatch(batchId: number | bigint, root: string, signatureHash: string, docCount: number): Promise<TxLike>;
  getBatch?(batchId: number | bigint): Promise<{ root: string; anchoredAt: bigint | number }>;
}
export interface TxLike { hash: string; wait(confirmations?: number): Promise<{ blockNumber: number; status?: number | null } | null> }

export class ChainService {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(readonly profile: ChainProfile, readonly registry: RegistryLike, readonly registryAddress: string, private readonly store: TxStore = dbTxStore) {}

  get enabled() { return true; }

  info(): ChainInfo {
    return { network: this.profile.key, chainId: this.profile.chainId, registryAddress: this.registryAddress,
      explorerAddressUrl: this.profile.explorerUrl ? `${this.profile.explorerUrl}/address/${this.registryAddress}` : null };
  }

  /** Serial queue: one broadcast at a time so nonces never collide. Never throws to the caller. */
  private enqueue(kind: ChainTxKind, label: string, ctx: { docId?: string; caseId?: string }, send: () => Promise<TxLike>): Promise<string | null> {
    const run = this.tail.then(async (): Promise<string | null> => {
      try {
        const tx = await send();
        const hash = tx.hash.toLowerCase();
        await this.store.insert({ kind, txHash: hash, chainId: this.profile.chainId, label, ...ctx });
        // Wait for this transaction to be mined BEFORE the next job is sent. On a real network (12 s blocks) a dependent call such as
        // attestSignature must see the record registered by the previous transaction, or its gas estimate reverts.
        // Request handlers never wait for this queue — only later chain jobs do — so uploads stay instant.
        const confirm = tx.wait(this.profile.confirmations).then(
          (r) => this.store.setStatus(hash, r && r.status === 0 ? "failed" : "confirmed", r?.blockNumber),
          (e) => this.store.setStatus(hash, "failed", undefined, String((e as Error).message)),
        ).catch((e) => console.error("[chain] could not record confirmation", e));
        await confirm;
        return hash;
      } catch (e) {
        console.error(`[chain] ${kind} failed: ${(e as Error).message}`);
        return null;
      }
    });
    this.tail = run.catch(() => undefined);
    return run;
  }

  /** Resolves when every queued job has been broadcast AND confirmed (used by tests and the deploy smoke check). */
  async idle(): Promise<void> { let t; do { t = this.tail; await t; } while (t !== this.tail); }

  registerRecord(d: { docId: string; caseId: string; filename: string; version: number; parentDocId?: string | null; sha256: string; chunkRoot: string; signatureB64: string; signerKeyHash: string }) {
    return this.enqueue("REGISTER_RECORD", `Registered ${d.filename} v${d.version}`, { docId: d.docId, caseId: d.caseId }, () =>
      this.registry.registerRecord(recordIdFor(d.docId), {
        documentHash: hex0x(d.sha256), chunkRoot: hex0x(d.chunkRoot), signatureHash: sha(d.signatureB64), signerKeyHash: hex0x(d.signerKeyHash),
        parentRecordId: d.parentDocId ? recordIdFor(d.parentDocId) : `0x${"0".repeat(64)}`, version: d.version, profileId: 1 }));
  }

  /** The off-chain ML-DSA-65 verdict. The chain stores WHO attested, the verdict and a hash of the evidence — it does not verify the signature itself. */
  attestSignature(d: { docId: string; caseId: string; filename: string; valid: boolean; evidence: string }) {
    return this.enqueue("ATTEST_SIGNATURE", `${d.valid ? "Signature verified (off-chain)" : "Signature INVALID (off-chain)"} for ${d.filename}`, { docId: d.docId, caseId: d.caseId },
      () => this.registry.attestSignature(recordIdFor(d.docId), d.valid ? 1 : 2, sha(d.evidence)));
  }

  sealCaseManifest(d: { caseId: string; firNo: string; version: number; root: string; documentCount: number }) {
    return this.enqueue("SEAL_MANIFEST", `Sealed case folder ${d.firNo} version ${d.version} (${d.documentCount} document${d.documentCount === 1 ? "" : "s"})`, { caseId: d.caseId },
      () => this.registry.sealCaseManifest(caseRefFor(d.caseId), d.version, hex0x(d.root), d.documentCount));
  }

  auditEvent(d: { subject: { docId?: string; caseId: string }; action: string; actorId: string; entryHash: string; label: string }) {
    const subjectId = d.subject.docId ? recordIdFor(d.subject.docId) : caseRefFor(d.subject.caseId);
    return this.enqueue("AUDIT_EVENT", d.label, { docId: d.subject.docId, caseId: d.subject.caseId },
      () => this.registry.logAuditEvent(subjectId, ACTION_INDEX[d.action], actorHashFor(d.actorId), hex0x(d.entryHash)));
  }

  anchorBatch(d: { batchId: number; root: string; signatureHash: string; docCount: number }) {
    return this.enqueue("ANCHOR_BATCH", `Anchored batch #${d.batchId} (${d.docCount} documents)`, {}, () =>
      this.registry.anchorBatch(d.batchId, hex0x(d.root), hex0x(d.signatureHash), d.docCount));
  }

  explorerUrl(txHash: string) { return explorerTxUrl(this.profile, txHash); }

  /** Root stored on-chain for a batch (plain lowercase hex), or null when the batch is not (yet) anchored there. Confirmed roots are immutable, so they are cached. */
  private roots = new Map<number, string>();
  async batchRoot(batchId: number): Promise<string | null> {
    const hit = this.roots.get(batchId);
    if (hit) return hit;
    if (!this.registry.getBatch) return null;
    const b = await this.registry.getBatch(batchId);
    if (!b || Number(b.anchoredAt) === 0) return null;
    const root = String(b.root).replace(/^0x/, "").toLowerCase();
    this.roots.set(batchId, root);
    return root;
  }
}

// ───────────────────────────── configuration
export interface ChainEnv { QS_CHAIN?: string; QS_REGISTRY_ADDRESS?: string; QS_CHAIN_SIGNER_PRIVATE_KEY?: string; NODE_ENV?: string; QS_ALLOW_MAINNET?: string; [k: string]: string | undefined }

/** Builds the live service from env, or returns null (disabled) when anything required is missing. Verifies the RPC's chain id first. */
export async function createChainService(env: ChainEnv = process.env as ChainEnv): Promise<ChainService | null> {
  const key = env.QS_CHAIN, address = env.QS_REGISTRY_ADDRESS, pk = env.QS_CHAIN_SIGNER_PRIVATE_KEY;
  if (!key || !address || !pk) return null;
  const profile = CHAINS[key as keyof typeof CHAINS];
  if (!profile) throw new Error(`Unknown QS_CHAIN "${key}"`);
  assertMainnetAllowed(profile, env);
  const url = env[profile.rpcEnv] || profile.defaultRpcUrl;
  const provider = new JsonRpcProvider(url, profile.chainId, { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1, pollingInterval: 2000 });
  assertChainId(profile, (await provider.getNetwork()).chainId); // refuse a wrong RPC before sending anything
  const registry = new Contract(address, REGISTRY_ABI, new Wallet(pk, provider)) as unknown as RegistryLike;
  return new ChainService(profile, registry, address);
}

const g = globalThis as unknown as { __sakshyaChain?: Promise<ChainService | null> };
export function getChain(): Promise<ChainService | null> {
  return (g.__sakshyaChain ??= createChainService().catch((e) => { console.error("[chain] disabled:", (e as Error).message); return null; }));
}
export function setChainForTests(c: ChainService | null | undefined) { g.__sakshyaChain = c === undefined ? undefined : Promise.resolve(c); }

export type { ChainTx };
