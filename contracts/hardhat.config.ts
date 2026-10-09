import { existsSync } from "node:fs";
import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { configVariable, defineConfig } from "hardhat/config";
import { CHAINS } from "./config/networks.ts";

// Hardhat 3 does not load .env files itself. Load contracts/.env, then the app's root .env.local
// (first value wins; real shell env vars always take precedence).
for (const file of [".env", "../.env.local"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const rpc = (key: keyof typeof CHAINS) => process.env[CHAINS[key].rpcEnv] || CHAINS[key].defaultRpcUrl;

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // paris = no PUSH0/MCOPY opcodes: deploys identically on local EDR, Amoy and Polygon PoS.
      evmVersion: "paris",
    },
  },
  networks: {
    // in-process chain used by `npx hardhat test` and one-off script runs
    hardhatMainnet: { type: "edr-simulated", chainType: "l1" },
    // `npx hardhat node` (chainId 31337)
    localhost: { type: "http", chainType: "l1", chainId: CHAINS.local.chainId, url: rpc("local") },
    sepolia: {
      type: "http",
      chainType: "l1",
      chainId: CHAINS.sepolia.chainId,
      url: rpc("sepolia"),
      accounts: [configVariable(CHAINS.sepolia.privateKeyEnv!)],
    },
    amoy: {
      type: "http",
      chainType: "l1",
      chainId: CHAINS.amoy.chainId,
      url: rpc("amoy"),
      accounts: [configVariable(CHAINS.amoy.privateKeyEnv!)],
    },
    // Defined so mainnet is *configurable*; scripts/deploy.ts refuses it unless explicitly acknowledged.
    polygon: {
      type: "http",
      chainType: "l1",
      chainId: CHAINS.polygon.chainId,
      url: rpc("polygon"),
      accounts: [configVariable(CHAINS.polygon.privateKeyEnv!)],
    },
  },
  // Etherscan API v2: one key covers every supported chain incl. Amoy (80002) and Polygon (137).
  verify: { etherscan: { apiKey: configVariable("ETHERSCAN_API_KEY") } },
});
