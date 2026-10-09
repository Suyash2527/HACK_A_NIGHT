// A stand-in for SakshyaRegistry so tests can exercise the whole anchoring path without a node.
import { randomBytes } from "node:crypto";
import { ChainService, type RegistryLike, type TxLike } from "../../lib/chain";
import { CHAINS } from "../../contracts/config/networks";

export class FakeRegistry implements RegistryLike {
  batches = new Map<number, { root: string; anchoredAt: number }>();
  calls: string[] = [];
  failNext = false;
  private tx(name: string): TxLike {
    this.calls.push(name);
    if (this.failNext) { this.failNext = false; return { hash: `0x${randomBytes(32).toString("hex")}`, wait: async () => { throw new Error("reverted"); } }; }
    return { hash: `0x${randomBytes(32).toString("hex")}`, wait: async () => ({ blockNumber: this.calls.length, status: 1 }) };
  }
  async registerRecord() { return this.tx("registerRecord"); }
  async attestSignature() { return this.tx("attestSignature"); }
  async sealCaseManifest() { return this.tx("sealCaseManifest"); }
  async logAuditEvent() { return this.tx("logAuditEvent"); }
  async anchorBatch(id: number | bigint, root: string) { const t = this.tx("anchorBatch"); if (!this.failedOnce) this.batches.set(Number(id), { root, anchoredAt: 1_800_000_000 }); return t; }
  failedOnce = false;
  async getBatch(id: number | bigint) { return this.batches.get(Number(id)) ?? { root: `0x${"0".repeat(64)}`, anchoredAt: 0 }; }
}

export const fakeChain = () => {
  const registry = new FakeRegistry();
  return { registry, service: new ChainService(CHAINS.sepolia, registry, "0x149A343Edc8da1edDb170E5308aBfe28C5BC4fDA") };
};
