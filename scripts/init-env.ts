// Creates .env.local with fresh random secrets for LOCAL development if they are missing. Prints no secret values.
//   npm run init:env
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { generateSeeds } from "../lib/crypto/pqc";

const FILE = ".env.local";
const current = existsSync(FILE) ? readFileSync(FILE, "utf8") : "";
const has = (k: string) => new RegExp(`^${k}=.+`, "m").test(current);
const add: string[] = [];
const seeds = generateSeeds();
const want: Record<string, () => string> = {
  SESSION_SECRET: () => randomBytes(32).toString("hex"),
  DEMO_PASSWORD: () => `Sk-${randomBytes(9).toString("base64url")}`,
  PQC_KEM_SEED: () => seeds.kemSeed,
  PQC_DSA_SEED: () => seeds.dsaSeed,
  ACTOR_HASH_SALT: () => randomBytes(16).toString("hex"),
};
for (const [k, make] of Object.entries(want)) if (!has(k)) add.push(`${k}=${make()}`);
if (add.length) appendFileSync(FILE, `${current && !current.endsWith("\n") ? "\n" : ""}# generated ${new Date().toISOString()} (local dev only)\n${add.join("\n")}\n`);
console.log(add.length ? `Added to ${FILE}: ${add.map((l) => l.split("=")[0]).join(", ")}` : `${FILE} already has all required secrets`);
console.log("Demo login password is in .env.local as DEMO_PASSWORD (open the file to read it).");
