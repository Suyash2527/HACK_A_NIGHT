// Merges the two teammates' folders (data/cases-A, data/cases-B, ...) into data/cases WITHOUT either of them touching the other's files.
//   node scripts/merge-data.mjs            -> writes data/cases/manifest.csv and copies the case folders
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const root = "data";
const sources = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && /^cases-[A-Za-z0-9]+$/.test(d.name)).map((d) => path.join(root, d.name));
if (!sources.length) { console.error("No data/cases-* folders found"); process.exit(1); }
const out = path.join(root, "cases"); mkdirSync(out, { recursive: true });
let header = null; const rows = []; const refs = new Map();
for (const dir of sources) {
  const mf = path.join(dir, "manifest.csv");
  if (!existsSync(mf)) { console.error(`${dir}: manifest.csv missing`); process.exit(1); }
  const lines = readFileSync(mf, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (header && lines[0].trim().toLowerCase() !== header.toLowerCase()) { console.error(`${dir}: manifest header differs from the other folder`); process.exit(1); }
  header ??= lines[0].trim();
  for (const l of lines.slice(1)) {
    const ref = l.split(",")[0].trim();
    if (refs.has(ref) && refs.get(ref) !== dir) { console.error(`case_ref ${ref} appears in both ${refs.get(ref)} and ${dir}`); process.exit(1); }
    refs.set(ref, dir); rows.push(l);
  }
  for (const d of readdirSync(dir, { withFileTypes: true })) if (d.isDirectory()) cpSync(path.join(dir, d.name), path.join(out, d.name), { recursive: true });
}
writeFileSync(path.join(out, "manifest.csv"), [header, ...rows].join("\n") + "\n");
console.log(`Merged ${sources.length} source folder(s): ${refs.size} case(s), ${rows.length} document row(s) -> ${out}/manifest.csv`);
