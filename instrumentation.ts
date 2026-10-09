// Runs once when the Next.js server starts. Starts the background anchoring loop: every minute, any documents that are not yet in a
// Merkle batch (fresh uploads, imported case files, or a batch whose transaction never confirmed) are anchored on-chain.
// No-op when no blockchain is configured, so local development and tests are unaffected.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.QS_REGISTRY_ADDRESS || !process.env.QS_CHAIN_SIGNER_PRIVATE_KEY) return;
  const { anchorPending } = await import("./lib/anchoring");
  const tick = () => anchorPending().catch((e) => console.error("[anchor] loop:", (e as Error).message));
  setTimeout(tick, 15_000).unref?.();
  setInterval(tick, 60_000).unref?.();
}
