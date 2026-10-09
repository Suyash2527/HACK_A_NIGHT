// Indexes all SakshyaRegistry events for the selected network into deployments/events-<chain>.json.
//   npm run index:local | npm run index:amoy      (INDEX_BLOCK_RANGE overrides the getLogs window)
import { readFileSync, writeFileSync } from "node:fs";
import { network } from "hardhat";
import { assertChainId } from "../config/networks.ts";
import { indexEvents } from "./lib/indexer.ts";
import { profileForNetwork } from "./lib/preflight.ts";

const { ethers, networkName } = await network.getOrCreate();
const profile = profileForNetwork(networkName);
assertChainId(profile, BigInt(await ethers.provider.send("eth_chainId", [])));

const deployment = JSON.parse(readFileSync(`deployments/${profile.key}.json`, "utf8"));
const registry = await ethers.getContractAt("SakshyaRegistry", deployment.address);
const latest = await ethers.provider.getBlockNumber();
const events = await indexEvents(registry, deployment.blockNumber, latest, Number(process.env.INDEX_BLOCK_RANGE ?? 1000));

const outPath = `deployments/events-${profile.key}.json`;
writeFileSync(outPath, JSON.stringify({ address: deployment.address, chainId: deployment.chainId, fromBlock: deployment.blockNumber, toBlock: latest, events }, null, 2));
const counts = events.reduce<Record<string, number>>((m, e) => ((m[e.event] = (m[e.event] ?? 0) + 1), m), {});
console.log(`Indexed ${events.length} events from blocks ${deployment.blockNumber}-${latest}:`, counts);
console.log(`→ contracts/${outPath}`);
