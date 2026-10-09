// Bulk import of case folders.   npm run import:cases -- data/cases        (add --check to only validate the manifest)
// Local: loads into the embedded database in .data/db (stop the dev server first — one process may use it at a time).
// AWS:   `.\infra\06-deploy.ps1 -ImportData data\cases` bundles this script and runs it on the server against RDS + S3.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDb } from "../lib/db";
import { importFromDirectory, planFromManifest } from "../lib/import-cases";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const dir = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "data/cases";
const checkOnly = process.argv.includes("--check");

const csv = await readFile(path.join(dir, "manifest.csv"), "utf8").catch(() => { console.error(`No manifest.csv in ${dir}`); process.exit(2); });
const { cases, errors } = planFromManifest(csv, (rel) => existsSync(path.join(dir, rel)));
if (errors.length) {
  console.error(`\n${errors.length} problem(s) in the manifest — nothing was imported:\n  ` + errors.slice(0, 60).join("\n  "));
  process.exit(1);
}
const docs = cases.reduce((n, c) => n + c.docs.length, 0);
console.log(`Manifest OK: ${cases.length} case(s), ${docs} document(s).`);
if (checkOnly) process.exit(0);

const { report } = await importFromDirectory(dir, undefined, (m) => console.log("  imported " + m));
console.log(`\nDone: ${report!.cases} case(s), ${report!.documents} document(s) imported.`);
if (report!.skipped.length) console.log("Skipped:\n  " + report!.skipped.join("\n  "));
await (await getDb()).close();
