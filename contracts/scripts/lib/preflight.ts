import { formatEther, getAddress, type JsonRpcProvider, type Provider } from "ethers";
import { assertChainId, assertMainnetAllowed, CHAINS, type ChainProfile } from "../../config/networks.ts";

/** Maps Hardhat network names (hardhat.config.ts) to Sakshya chain profiles. */
const NETWORK_TO_CHAIN: Record<string, ChainProfile> = {
  hardhatMainnet: CHAINS.local, // in-process EDR — named by Hardhat's chainType, NOT Polygon mainnet
  default: CHAINS.local,
  localhost: CHAINS.local,
  sepolia: CHAINS.sepolia,
  amoy: CHAINS.amoy,
  polygon: CHAINS.polygon,
};

export function profileForNetwork(networkName: string): ChainProfile {
  const p = NETWORK_TO_CHAIN[networkName];
  if (!p) throw new Error(`No Sakshya chain profile for Hardhat network "${networkName}"`);
  return p;
}

// First accounts of Hardhat's public test mnemonic. Their keys are public: never deploy with them off-local.
const HARDHAT_DEV_ACCOUNTS = new Set(
  [
    "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  ].map((a) => getAddress(a)),
);

export interface PreflightResult {
  profile: ChainProfile;
  chainId: bigint;
  deployer: string;
  balanceWei: bigint;
  blockNumber: number;
}

/**
 * Hard safety checks before any state-changing transaction:
 *  1. mainnet requires explicit acknowledgement (QS_ALLOW_MAINNET + NODE_ENV=production)
 *  2. the RPC's real chainId must equal the profile's (e.g. 80002 for Amoy) — catches a wrong RPC URL
 *  3. publicly-known Hardhat dev keys are rejected on any non-local chain
 *  4. remote deployers must hold gas
 */
/**
 * Checks 1 + 2 only. Needs no signer, so scripts call it BEFORE ethers.getSigners() — that way a
 * mainnet attempt or a wrong RPC is refused even when the private-key variable isn't set.
 */
export async function guardChain(networkName: string, provider: Provider): Promise<{ profile: ChainProfile; chainId: bigint }> {
  const profile = profileForNetwork(networkName);
  assertMainnetAllowed(profile);
  const chainId = BigInt(await (provider as JsonRpcProvider).send("eth_chainId", []));
  assertChainId(profile, chainId);
  return { profile, chainId };
}

export async function preflight(networkName: string, provider: Provider, deployer: string): Promise<PreflightResult> {
  const { profile, chainId } = await guardChain(networkName, provider);

  const addr = getAddress(deployer);
  if (profile.key !== "local" && HARDHAT_DEV_ACCOUNTS.has(addr)) {
    throw new Error(`Deployer ${addr} is a public Hardhat dev account. Use a dedicated testnet key (npm run wallet:new).`);
  }

  const [balanceWei, blockNumber] = await Promise.all([provider.getBalance(addr), provider.getBlockNumber()]);
  if (profile.key !== "local" && balanceWei === 0n) {
    throw new Error(`Deployer ${addr} has 0 ${profile.nativeToken} on ${profile.name}. Fund it from a faucet first.`);
  }
  return { profile, chainId, deployer: addr, balanceWei, blockNumber };
}

export function describePreflight(r: PreflightResult): string {
  return [
    `network      : ${r.profile.name} (${r.profile.key})`,
    `chainId      : ${r.chainId} ✔ matches expected ${r.profile.chainId}`,
    `deployer     : ${r.deployer}`,
    `balance      : ${formatEther(r.balanceWei)} ${r.profile.nativeToken}`,
    `latest block : ${r.blockNumber}`,
  ].join("\n");
}
