"use client";
import { useEffect, useState } from "react";
import type { ChainTx, Page } from "@/types/api";
import { apiFetch, USE_MOCKS } from "@/components/api-client";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { SectionCard, humanize } from "./design-system";
const offline: Page<ChainTx> = { items: [], nextCursor: null };
export function BlockchainActivity({ docId }: {
    docId?: string;
}) {
    const [feed, setFeed] = useState<Page<ChainTx> | null>(null), [error, setError] = useState(""), [revision, setRevision] = useState(0);
    useEffect(() => { let active = true; let controller: AbortController | null = null; async function refresh() { if (document.visibilityState !== "visible")
        return; controller?.abort(); controller = new AbortController(); try {
        const data = await apiFetch("GET /api/chain/transactions", { query: { docId, limit: 10 }, signal: controller.signal, mock: offline });
        if (active) {
            setFeed(data);
            setError("");
        }
    }
    catch (e) {
        if (active && !(e instanceof Error && e.name === "AbortError"))
            setError(e instanceof Error ? e.message : "Activity unavailable");
    } } void refresh(); const timer = setInterval(() => void refresh(), 10000); document.addEventListener("visibilitychange", refresh); return () => { active = false; controller?.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", refresh); }; }, [docId, revision]);
    return <SectionCard title="Live blockchain activity" description={USE_MOCKS ? "Offline demo. No live transactions." : "Refreshes every 10 seconds while this tab is visible."} action={<Button variant="outline" size="sm" onClick={() => setRevision(n => n + 1)}>Refresh</Button>}>{error && <p role="alert" className="mb-2 text-xs text-tampered">{error}{feed ? " · Previous results retained" : ""}</p>}<Table><TableHeader><TableRow><TableHead>Kind</TableHead><TableHead>Record</TableHead><TableHead>Status</TableHead><TableHead>Block</TableHead><TableHead>Transaction</TableHead></TableRow></TableHeader><TableBody>{feed?.items.map(tx => { const explorer = tx.explorerUrl; const safe = explorer && ["https://sepolia.etherscan.io/", "https://etherscan.io/", "https://amoy.polygonscan.com/", "https://polygonscan.com/"].some(prefix => explorer.startsWith(prefix)); return <TableRow key={tx.id}><TableCell>{humanize(tx.kind)}</TableCell><TableCell className="max-w-sm whitespace-normal">{tx.label}</TableCell><TableCell><span className={"status-pill " + (tx.status === "failed" ? "tone-danger" : tx.status === "submitted" ? "tone-pending" : "tone-neutral")}>{humanize(tx.status)}</span></TableCell><TableCell className="font-mono">{tx.blockNumber ?? "—"}</TableCell><TableCell>{safe ? <a href={explorer} target="_blank" rel="noreferrer" className="font-mono text-xs text-[#c2410c] underline" title={tx.txHash}>{tx.txHash.slice(0, 10)}…{tx.txHash.slice(-6)}</a> : <span className="text-xs text-muted-foreground">{explorer ? "Explorer unavailable" : "Local dev chain"}<span className="block font-mono" title={tx.txHash}>{tx.txHash.slice(0, 10)}…{tx.txHash.slice(-6)}</span></span>}</TableCell></TableRow>; })}{!feed && !error && Array.from({ length: 3 }, (_, i) => <TableRow key={i}><TableCell colSpan={5}><div className="h-5 bg-[#e9e4d8]" aria-label="Loading transactions"/></TableCell></TableRow>)}{feed && !feed.items.length && <TableRow><TableCell colSpan={5} className="text-muted-foreground">No transactions recorded</TableCell></TableRow>}</TableBody></Table></SectionCard>;
}
