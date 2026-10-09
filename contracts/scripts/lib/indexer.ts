import type { BaseContract, EventLog, Log } from "ethers";

export interface IndexedEvent {
  event: string;
  blockNumber: number;
  txHash: string;
  logIndex: number;
  args: Record<string, string>;
}

/**
 * Fetches and decodes every registry event in [fromBlock, toBlock] in fixed-size windows.
 * Free public RPCs cap eth_getLogs ranges, so the window is small and configurable.
 */
export async function indexEvents(
  contract: BaseContract,
  fromBlock: number,
  toBlock: number,
  step = 1000,
): Promise<IndexedEvent[]> {
  const out: IndexedEvent[] = [];
  for (let start = fromBlock; start <= toBlock; start += step) {
    const end = Math.min(start + step - 1, toBlock);
    const logs = await contract.queryFilter("*", start, end);
    for (const log of logs) out.push(decode(contract, log));
  }
  return out.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
}

function decode(contract: BaseContract, log: EventLog | Log): IndexedEvent {
  const parsed = "fragment" in log ? { name: log.fragment.name, args: log.args, fragment: log.fragment } : null;
  const p = parsed ?? (() => {
    const d = contract.interface.parseLog(log);
    return d ? { name: d.name, args: d.args, fragment: d.fragment } : null;
  })();
  const args: Record<string, string> = {};
  if (p) p.fragment.inputs.forEach((input, i) => (args[input.name] = String(p.args[i])));
  return { event: p?.name ?? "Unknown", blockNumber: log.blockNumber, txHash: log.transactionHash, logIndex: log.index, args };
}
