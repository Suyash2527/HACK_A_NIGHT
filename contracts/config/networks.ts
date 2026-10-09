// Single source of truth for which chain Sakshya talks to.
// Dependency-free on purpose: imported by Hardhat scripts AND (later) by the Next.js backend.
//
// Select with QS_CHAIN = local | amoy | polygon   (default: local)
// Mainnet is opt-in twice over: QS_CHAIN=polygon AND QS_ALLOW_MAINNET=I_UNDERSTAND_REAL_FUNDS
// AND NODE_ENV=production. Anything less throws, so dev machines cannot touch mainnet by accident.

export type ChainKey = "local" | "sepolia" | "amoy" | "polygon";

export interface ChainProfile {
  key: ChainKey;
  name: string;
  chainId: number;
  nativeToken: "ETH" | "POL";
  /** env var holding the RPC URL; the default is used only when the var is unset */
  rpcEnv: string;
  defaultRpcUrl: string;
  /** env var holding the deployer/backend signer key — never committed, never shared across networks */
  privateKeyEnv: string | null;
  explorerUrl: string | null;
  isMainnet: boolean;
  /** confirmations the backend waits for before treating a tx as final */
  confirmations: number;
}

export const CHAINS: Record<ChainKey, ChainProfile> = {
  local: {
    key: "local",
    name: "Hardhat local node",
    chainId: 31337,
    nativeToken: "ETH",
    rpcEnv: "LOCAL_RPC_URL",
    defaultRpcUrl: "http://127.0.0.1:8545",
    privateKeyEnv: null, // uses Hardhat's well-known dev accounts — never valid anywhere else
    explorerUrl: null,
    isMainnet: false,
    confirmations: 1,
  },
  sepolia: {
    key: "sepolia",
    name: "Ethereum Sepolia testnet",
    chainId: 11155111,
    nativeToken: "ETH",
    rpcEnv: "SEPOLIA_RPC_URL",
    // public RPC, verified answering eth_chainId = 0xaa36a7 on 2026-10-09
    defaultRpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    privateKeyEnv: "SEPOLIA_DEPLOYER_PRIVATE_KEY",
    explorerUrl: "https://sepolia.etherscan.io",
    isMainnet: false,
    confirmations: 1, // ~12 s blocks; the UI shows "pending" until confirmed
  },
  amoy: {
    key: "amoy",
    name: "Polygon Amoy testnet",
    chainId: 80002,
    nativeToken: "POL",
    rpcEnv: "AMOY_RPC_URL",
    // Polygon docs (docs.polygon.technology/pos/reference/rpc-endpoints, checked 2026-10-09).
    // NOTE: rpc-amoy.polygon.technology did not resolve on 2026-10-09 — do not use it as default.
    defaultRpcUrl: "https://polygon-amoy.drpc.org",
    privateKeyEnv: "AMOY_DEPLOYER_PRIVATE_KEY",
    explorerUrl: "https://amoy.polygonscan.com",
    isMainnet: false,
    confirmations: 2,
  },
  polygon: {
    key: "polygon",
    name: "Polygon PoS mainnet",
    chainId: 137,
    nativeToken: "POL",
    rpcEnv: "POLYGON_RPC_URL",
    defaultRpcUrl: "https://polygon.drpc.org",
    privateKeyEnv: "POLYGON_DEPLOYER_PRIVATE_KEY",
    explorerUrl: "https://polygonscan.com",
    isMainnet: true,
    confirmations: 5,
  },
};

export const MAINNET_ACK = "I_UNDERSTAND_REAL_FUNDS";

type Env = Record<string, string | undefined>;

export class ChainConfigError extends Error {}

/** Throws unless mainnet use is explicitly acknowledged in a production environment. */
export function assertMainnetAllowed(profile: ChainProfile, env: Env = process.env): void {
  if (!profile.isMainnet) return;
  if (env.QS_ALLOW_MAINNET !== MAINNET_ACK || env.NODE_ENV !== "production") {
    throw new ChainConfigError(
      `Refusing to use ${profile.name} (chainId ${profile.chainId}). ` +
        `Mainnet requires QS_ALLOW_MAINNET=${MAINNET_ACK} and NODE_ENV=production.`,
    );
  }
}

export function chainByKey(key: string): ChainProfile {
  if (!(key in CHAINS)) throw new ChainConfigError(`Unknown chain "${key}". Use one of: ${Object.keys(CHAINS).join(", ")}`);
  return CHAINS[key as ChainKey];
}

export function chainById(chainId: number | bigint): ChainProfile | undefined {
  return Object.values(CHAINS).find((c) => BigInt(c.chainId) === BigInt(chainId));
}

/** Resolves the active chain for the app/backend from env (QS_CHAIN), enforcing the mainnet guard. */
export function resolveChain(env: Env = process.env): ChainProfile & { rpcUrl: string } {
  const profile = chainByKey(env.QS_CHAIN ?? "local");
  assertMainnetAllowed(profile, env);
  return { ...profile, rpcUrl: env[profile.rpcEnv] || profile.defaultRpcUrl };
}

/** Compares the chainId reported by the RPC with the one the profile expects. */
export function assertChainId(profile: ChainProfile, reportedChainId: number | bigint): void {
  if (BigInt(reportedChainId) !== BigInt(profile.chainId)) {
    throw new ChainConfigError(
      `Chain ID mismatch: ${profile.name} expects ${profile.chainId}, RPC reported ${reportedChainId}. Aborting.`,
    );
  }
}

export function explorerTxUrl(profile: ChainProfile, txHash: string): string | null {
  return profile.explorerUrl ? `${profile.explorerUrl}/tx/${txHash}` : null;
}

export function explorerAddressUrl(profile: ChainProfile, address: string): string | null {
  return profile.explorerUrl ? `${profile.explorerUrl}/address/${address}` : null;
}

/**
 * Crypto profile registered on-chain at deploy time. The contract stores only the SHA-256 of
 * this descriptor; the human-readable string lives here and in the deployment report.
 */
export const CRYPTO_PROFILE_V1 = {
  id: 1,
  descriptor:
    "Sakshya/v1;kem=ML-KEM-768(FIPS203);kdf=HKDF-SHA-256;aead=AES-256-GCM;sig=ML-DSA-65(FIPS204);hash=SHA-256;merkle=SHA-256-sorted-pairs,4096B-chunks",
} as const;
