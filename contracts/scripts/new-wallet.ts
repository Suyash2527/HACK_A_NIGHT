// Creates a FRESH, testnet-only deployer key and stores it in contracts/.env (gitignored).
// Prints only the address, so the key never appears in a terminal log or chat.
// Usage: npm run wallet:new        (refuses to overwrite an existing AMOY_DEPLOYER_PRIVATE_KEY)
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { Wallet } from "ethers";

const FILE = ".env";
const VAR = "AMOY_DEPLOYER_PRIVATE_KEY";
const current = existsSync(FILE) ? readFileSync(FILE, "utf8") : "";
if (new RegExp(`^${VAR}=`, "m").test(current)) {
  const pk = current.match(new RegExp(`^${VAR}=(.*)$`, "m"))![1].trim();
  console.log(`${VAR} already set in contracts/${FILE}. Address: ${new Wallet(pk).address}`);
  process.exit(0);
}
const wallet = Wallet.createRandom();
appendFileSync(FILE, `${current && !current.endsWith("\n") ? "\n" : ""}# testnet-only deployer, created ${new Date().toISOString()}\n${VAR}=${wallet.privateKey}\n`);
console.log(`New Amoy deployer address: ${wallet.address}`);
console.log(`Key saved to contracts/${FILE} (gitignored). Fund this address with test POL from an Amoy faucet.`);
