// Manual anchoring.   npm run anchor        (needs QS_* chain settings in .env.local)
// Normally the server does this itself every minute; use this to anchor on demand from a developer machine.
// Do NOT run it while the same signer key is also used by a live server (two processes would race for the same nonce).
import { existsSync } from "node:fs";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const { anchorPending } = await import("../lib/anchoring");
const { getDb } = await import("../lib/db");
const r = await anchorPending();
console.log(r ? `Batch #${r.batchId}: ${r.docCount} document(s), root ${r.root}, tx ${r.txHash ?? "none"}, ${r.confirmed ? "confirmed" : "NOT confirmed"}` : "Nothing to anchor (or no chain configured).");
await (await getDb()).close();
process.exit(r && !r.confirmed ? 1 : 0);
