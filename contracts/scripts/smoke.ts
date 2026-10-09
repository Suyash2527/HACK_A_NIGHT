// Exercises every write path against the DEPLOYED registry: register -> attest -> audit event -> batch anchor.
// Uses fresh random IDs so it can be re-run.   npm run smoke:local | npm run smoke:amoy (spends test POL)
// Doubles as reference code for the Next.js backend integration (plain ethers v6 calls).
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { hexlify, sha256, toUtf8Bytes, ZeroHash } from "ethers";
import { network } from "hardhat";
import { explorerTxUrl } from "../config/networks.ts";
import { guardChain, preflight } from "./lib/preflight.ts";

const { ethers, networkName } = await network.getOrCreate();
await guardChain(networkName, ethers.provider); // refuse mainnet / wrong chain before touching keys
const [signer] = await ethers.getSigners();
const { profile } = await preflight(networkName, ethers.provider, signer.address);
const deployment = JSON.parse(readFileSync(`deployments/${profile.key}.json`, "utf8"));
const registry = await ethers.getContractAt("SakshyaRegistry", deployment.address);

const h = (s: string) => sha256(toUtf8Bytes(s));
const nonce = hexlify(randomBytes(8));
const recordId = h(`qs:doc:smoke:${nonce}`);

const step = async (label: string, txp: Promise<{ hash: string; wait: (n?: number) => Promise<unknown> }>) => {
  const tx = await txp;
  await tx.wait(profile.confirmations);
  console.log(`✔ ${label.padEnd(16)} ${tx.hash}${explorerTxUrl(profile, tx.hash) ? "  " + explorerTxUrl(profile, tx.hash) : ""}`);
};

await step("registerRecord", registry.registerRecord(recordId, {
  documentHash: h(`doc:${nonce}`), chunkRoot: h(`chunks:${nonce}`), signatureHash: h(`sig:${nonce}`),
  signerKeyHash: h("smoke-signer-pk"), parentRecordId: ZeroHash, version: 1, profileId: 1,
}));
await step("attestSignature", registry.attestSignature(recordId, 1, h(`evidence:${nonce}`)));
await step("logAuditEvent", registry.logAuditEvent(recordId, 0, h("actor:smoke"), h(`audit:${nonce}`)));
const batchId = BigInt("0x" + randomBytes(6).toString("hex"));
await step("anchorBatch", registry.anchorBatch(batchId, h(`root:${nonce}`), h(`batchsig:${nonce}`), 1));

const caseRef = h(`qs:case:smoke:${nonce}`);
await step("sealCaseManifest", registry.sealCaseManifest(caseRef, 1, h(`case-root:${nonce}`), 1));
await step("logAuditEvent(case)", registry.logAuditEvent(caseRef, 9, h("actor:advocate"), h(`request:${nonce}`)));

const s = await registry.getAuditState(recordId);
console.log(`record ${recordId}: auditCount=${s.count} head=${s.head}`);
