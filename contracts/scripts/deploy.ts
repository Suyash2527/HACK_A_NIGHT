// Deploys SakshyaRegistry and writes a deployment report.
//   npm run deploy:local   (needs `npm run node` in another terminal)
//   npm run deploy:amoy    (needs AMOY_DEPLOYER_PRIVATE_KEY funded with test POL)
// Role addresses default to the deployer; override with QS_ADMIN_ADDRESS / QS_RECORDER_ADDRESS / QS_VERIFIER_ADDRESS.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { formatEther, getAddress, sha256, toUtf8Bytes } from "ethers";
import { network } from "hardhat";
import { CRYPTO_PROFILE_V1, explorerAddressUrl, explorerTxUrl } from "../config/networks.ts";
import { describePreflight, guardChain, preflight } from "./lib/preflight.ts";

const CONTRACT = "SakshyaRegistry";
const { ethers, networkName } = await network.getOrCreate();
await guardChain(networkName, ethers.provider); // refuse mainnet / wrong chain before touching keys
const [deployer] = await ethers.getSigners();

// 1. safety checks — throws before anything is sent (chain ID, mainnet guard, dev keys, balance)
const pf = await preflight(networkName, ethers.provider, deployer.address);
console.log(describePreflight(pf));
const { profile } = pf;

const roleAddr = (name: string) => getAddress(process.env[name] || deployer.address);
const admin = roleAddr("QS_ADMIN_ADDRESS");
const recorder = roleAddr("QS_RECORDER_ADDRESS");
const verifier = roleAddr("QS_VERIFIER_ADDRESS");
const profileDescriptorHash = sha256(toUtf8Bytes(CRYPTO_PROFILE_V1.descriptor));
const constructorArgs = [admin, recorder, verifier, profileDescriptorHash] as const;

// 2. deploy and wait for the profile's confirmation count
const registry = await ethers.deployContract(CONTRACT, [...constructorArgs]);
const deployTx = registry.deploymentTransaction();
if (!deployTx) throw new Error("No deployment transaction returned");
console.log(`\ndeployment tx: ${deployTx.hash} — waiting for ${profile.confirmations} confirmation(s)...`);
const receipt = await deployTx.wait(profile.confirmations);
if (!receipt || receipt.status !== 1) throw new Error(`Deployment transaction failed: ${deployTx.hash}`);
const address = await registry.getAddress();

// 3. post-deploy sanity: code exists, roles + crypto profile are what we asked for
const code = await ethers.provider.getCode(address);
if (code === "0x") throw new Error(`No bytecode at ${address}`);
const onChainProfile = await registry.getCryptoProfile(1);
if (onChainProfile.descriptorHash !== profileDescriptorHash || !onChainProfile.active) throw new Error("Crypto profile 1 mismatch");
for (const [role, who] of [["RECORDER_ROLE", recorder], ["VERIFIER_ROLE", verifier], ["DEFAULT_ADMIN_ROLE", admin]] as const) {
  if (!(await registry.hasRole(await registry[role](), who))) throw new Error(`${role} not granted to ${who}`);
}

// 4. artifacts for the backend + report
const artifact = JSON.parse(readFileSync(`artifacts/contracts/${CONTRACT}.sol/${CONTRACT}.json`, "utf8"));
mkdirSync("deployments/abi", { recursive: true });
const abiPath = `deployments/abi/${CONTRACT}.json`;
writeFileSync(abiPath, JSON.stringify(artifact.abi, null, 2));

const deployment = {
  contract: CONTRACT,
  network: profile.key,
  networkName: profile.name,
  chainId: Number(pf.chainId),
  address,
  deploymentTxHash: deployTx.hash,
  blockNumber: receipt.blockNumber,
  gasUsed: receipt.gasUsed.toString(),
  feePaid: formatEther(receipt.fee) + " " + profile.nativeToken,
  deployer: deployer.address,
  roles: { admin, recorder, verifier },
  cryptoProfile: { id: CRYPTO_PROFILE_V1.id, descriptor: CRYPTO_PROFILE_V1.descriptor, descriptorHash: profileDescriptorHash },
  constructorArgs,
  abiPath: `contracts/${abiPath}`,
  explorer: { tx: explorerTxUrl(profile, deployTx.hash), address: explorerAddressUrl(profile, address) },
  deployedAt: new Date().toISOString(),
};
writeFileSync(`deployments/${profile.key}.json`, JSON.stringify(deployment, null, 2));

const report = `# ${CONTRACT} deployment — ${profile.name}

| Field | Value |
|---|---|
| Contract address | \`${address}\` |
| Chain ID | ${deployment.chainId} |
| Deployment tx | \`${deployTx.hash}\` |
| Block | ${receipt.blockNumber} |
| Gas used / fee | ${deployment.gasUsed} / ${deployment.feePaid} |
| Deployer | \`${deployer.address}\` |
| Roles | admin \`${admin}\`, recorder \`${recorder}\`, verifier \`${verifier}\` |
| Crypto profile 1 | \`${profileDescriptorHash}\` = sha256("${CRYPTO_PROFILE_V1.descriptor}") |
| ABI | \`contracts/${abiPath}\` |
| Explorer (tx) | ${deployment.explorer.tx ?? "n/a (local chain)"} |
| Explorer (contract) | ${deployment.explorer.address ?? "n/a (local chain)"} |
| Deployed at | ${deployment.deployedAt} |

${profile.explorerUrl ? `Verify source:\n\n\`\`\`bash\nnpx hardhat verify --network ${networkName} ${address} ${constructorArgs.join(" ")}\n\`\`\`\n` : ""}
Backend env:

\`\`\`
QS_CHAIN=${profile.key}
QS_REGISTRY_ADDRESS=${address}
QS_REGISTRY_DEPLOY_BLOCK=${receipt.blockNumber}
\`\`\`
`;
writeFileSync(`deployments/${profile.key}.md`, report);
console.log(`\n✔ ${CONTRACT} deployed at ${address} (block ${receipt.blockNumber}, gas ${receipt.gasUsed})`);
console.log(`  report: contracts/deployments/${profile.key}.md`);
if (deployment.explorer.tx) console.log(`  explorer: ${deployment.explorer.tx}`);
