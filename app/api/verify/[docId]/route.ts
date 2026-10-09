import { disabled } from "@/lib/http";

export const runtime = "nodejs";

// Deferred (bonus): public opt-in receipts are not built. The UI renders its "unavailable" state.
export const GET = disabled("Public verification receipts are not enabled");
