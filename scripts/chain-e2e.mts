// End-to-end proof against a REAL chain: upload → tamper → restore through the app logic, then read the registry back.
//   local:   (cd contracts && npm run node)  +  (cd contracts && npm run deploy:local)  then:  npm run chain:e2e
//   sepolia: QS_CHAIN=sepolia QS_REGISTRY_ADDRESS=0x… QS_CHAIN_SIGNER_PRIVATE_KEY=0x… npm run chain:e2e   (spends a little test ETH)
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Contract, JsonRpcProvider } from "ethers";
import { generateSeeds } from "../lib/crypto/pqc";
import { createPgliteDatabase, setDbForTests } from "../lib/db";
import { REGISTRY_ABI } from "../lib/chain-abi";
import { caseRefFor, createChainService, recordIdFor } from "../lib/chain";
import { demoUserByRole } from "../lib/demo-users";
import { insiderAttack } from "../lib/demo-attack";
import { restoreDocument, uploadDocument, verifyDocumentById } from "../lib/evidence";
import { ensureDemoUsers } from "../lib/seed";
import type { SessionUser } from "../lib/session";
import { LocalPartStore } from "../lib/storage/part-store";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
// local-chain convenience: read the address deploy:local wrote, and use Hardhat's well-known dev account #0 (local chain only)
const env = { ...process.env } as Record<string, string | undefined>;
env.QS_CHAIN ??= "local";
if (env.QS_CHAIN === "local") {
  env.QS_REGISTRY_ADDRESS ||= JSON.parse(readFileSync("contracts/deployments/local.json", "utf8")).address;
  env.QS_CHAIN_SIGNER_PRIVATE_KEY ||= "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
}
Object.assign(process.env, { PQC_KEM_SEED: generateSeeds().kemSeed, PQC_DSA_SEED: generateSeeds().dsaSeed, SAKSHYA_ALLOW_ATTACK_IN_TESTS: "1" });

const chain = await createChainService(env);
if (!chain) { console.error("chain not configured"); process.exit(2); }
console.log(`chain: ${chain.profile.name} (id ${chain.profile.chainId}), registry ${chain.registryAddress}`);

const dir = await mkdtemp(path.join(tmpdir(), "sakshya-e2e-")); const store = new LocalPartStore(dir);
const db = await createPgliteDatabase(); setDbForTests(db); await ensureDemoUsers(db);
const police = demoUserByRole("POLICE") as SessionUser;
const caseId = (await db.withUser(police.id, async (t) => (await t.query("SELECT case_id AS id FROM create_case()")).rows[0].id)) as string;
const deps = { store, chainService: chain };

const up = await uploadDocument(police, { caseId, type: "FIR", filename: "FIR_demo.txt", mimeType: "text/plain", bytes: Buffer.from("Fictional FIR. ".repeat(4000)) }, deps);
await insiderAttack(up.document.id, 9000, store);
const tamper = await verifyDocumentById(police, up.document.id, deps);
const restored = await restoreDocument(police, up.document.id, "Recover retained original after integrity incident", deps);
await chain.idle();

const feed = await db.withAdmin(async (t) => (await t.query("SELECT kind, status, block_number, tx_hash, label FROM chain_txs ORDER BY created_at")).rows);
console.log(`\nTamper verdict: ${tamper.status} ${JSON.stringify(tamper.tamperRanges)}`);
console.log("\nTransactions sent:");
for (const r of feed) console.log(`  ${String(r.kind).padEnd(16)} ${String(r.status).padEnd(10)} block ${String(r.block_number).padEnd(8)} ${chain.explorerUrl(r.tx_hash) ?? r.tx_hash}\n      ${r.label}`);

// read the public registry back and compare with what the app believes
const reg = new Contract(chain.registryAddress, REGISTRY_ABI, new JsonRpcProvider(env[chain.profile.rpcEnv] || chain.profile.defaultRpcUrl, chain.profile.chainId, { staticNetwork: true }));
const checks: [string, boolean][] = [
  ["original document is registered on-chain", await reg.isRegistered(recordIdFor(up.document.id))],
  ["restored version is registered on-chain", await reg.isRegistered(recordIdFor(restored.document.id))],
  ["case folder manifest is at version 2", Number((await reg.getCaseManifest(caseRefFor(caseId))).version) === 2],
  ["all transactions confirmed", feed.length >= 8 && feed.every((r) => r.status === "confirmed")],
];
let ok = true;
for (const [label, pass] of checks) { console.log(`${pass ? "PASS" : "FAIL"}  ${label}`); ok &&= pass; }
setDbForTests(undefined); await db.close(); await rm(dir, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
