// Read-only check: `npm run preflight:amoy` (or :local). Sends no transactions.
// Verifies RPC reachability, chain ID (80002 for Amoy), deployer key, balance and deploy gas cost.
import { formatEther, formatUnits, sha256, toUtf8Bytes } from "ethers";
import { network } from "hardhat";
import { CRYPTO_PROFILE_V1 } from "../config/networks.ts";
import { describePreflight, guardChain, preflight } from "./lib/preflight.ts";

const { ethers, networkName } = await network.getOrCreate();
await guardChain(networkName, ethers.provider); // refuse mainnet / wrong chain before touching keys
const [deployer] = await ethers.getSigners();
const result = await preflight(networkName, ethers.provider, deployer.address);
console.log(describePreflight(result));

const factory = await ethers.getContractFactory("SakshyaRegistry");
const tx = await factory.getDeployTransaction(
  deployer.address,
  deployer.address,
  deployer.address,
  sha256(toUtf8Bytes(CRYPTO_PROFILE_V1.descriptor)),
);
const [gas, fee] = await Promise.all([ethers.provider.estimateGas({ ...tx, from: deployer.address }), ethers.provider.getFeeData()]);
const price = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
const cost = gas * price;
console.log(`deploy gas   : ${gas} @ ${formatUnits(price, "gwei")} gwei max = ~${formatEther(cost)} ${result.profile.nativeToken}`);
if (result.profile.key !== "local" && result.balanceWei < cost) {
  console.error(`✖ balance too low for deployment (need ~${formatEther(cost)}).`);
  process.exitCode = 1;
} else {
  console.log("✔ preflight passed");
}
