"use client";
import { useEffect, useState } from "react";
import type { ChainTx, Page } from "@/types/api";
import { api } from "@/components/api-client";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { useI18n } from "./i18n";

const REFRESH_MS = 10000;
const EXPLORERS = ["https://sepolia.etherscan.io/", "https://etherscan.io/", "https://amoy.polygonscan.com/", "https://polygonscan.com/"];

export function BlockchainActivity({ docId }: { docId?: string }) {
  const { t, label } = useI18n();
  const [feed, setFeed] = useState<Page<ChainTx> | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    async function refresh() {
      if (document.visibilityState !== "visible") return;
      controller?.abort();
      controller = new AbortController();
      try {
        const data = await api("GET /api/chain/transactions", { query: { docId, limit: 10 }, signal: controller.signal });
        if (active) {
          setFeed(data);
          setError("");
        }
      } catch (e) {
        if (active && !(e instanceof Error && e.name === "AbortError")) setError(e instanceof Error ? e.message : t("chain.failed"));
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      controller?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [docId, revision, t]);

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{t("chain.title")}</h3>
          <p className="text-sm text-muted-foreground">{t("chain.sub")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setRevision(n => n + 1)}>{t("chain.refresh")}</Button>
      </div>
      {error && <p role="alert" className="my-2 text-sm text-tampered">{error}{feed ? " · " + t("chain.kept") : ""}</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("col.kind")}</TableHead>
            <TableHead>{t("col.record")}</TableHead>
            <TableHead>{t("col.status")}</TableHead>
            <TableHead>{t("col.block")}</TableHead>
            <TableHead>{t("col.transaction")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {feed?.items.map(tx => {
            const explorer = tx.explorerUrl;
            const safe = explorer && EXPLORERS.some(prefix => explorer.startsWith(prefix));
            const short = tx.txHash.slice(0, 10) + "…" + tx.txHash.slice(-6);
            return (
              <TableRow key={tx.id}>
                <TableCell>{label(tx.kind)}</TableCell>
                <TableCell className="max-w-sm whitespace-normal">{tx.label}</TableCell>
                <TableCell><span className={"status-pill " + (tx.status === "failed" ? "tone-danger" : tx.status === "submitted" ? "tone-pending" : "tone-neutral")}>{label(tx.status)}</span></TableCell>
                <TableCell className="font-mono">{tx.blockNumber ?? "—"}</TableCell>
                <TableCell>
                  {safe
                    ? <a href={explorer} target="_blank" rel="noreferrer" className="font-mono text-xs text-primary underline" title={tx.txHash}>{short}</a>
                    : <span className="text-sm text-muted-foreground">{explorer ? t("chain.noExplorer") : t("chain.local")}<span className="block font-mono" title={tx.txHash}>{short}</span></span>}
                </TableCell>
              </TableRow>
            );
          })}
          {!feed && !error && Array.from({ length: 3 }, (_, i) => (
            <TableRow key={i}><TableCell colSpan={5}><div className="h-5 bg-muted" aria-label={t("chain.loading")} /></TableCell></TableRow>
          ))}
          {feed && !feed.items.length && <TableRow><TableCell colSpan={5} className="text-muted-foreground">{t("chain.none")}</TableCell></TableRow>}
        </TableBody>
      </Table>
    </section>
  );
}
