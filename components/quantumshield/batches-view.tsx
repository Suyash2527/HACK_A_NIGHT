"use client";
import { Check, Clock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useResource } from "./use-resource";
import { ResourceError } from "./access-state";
import { CopyableHash, DataTable, PageSkeleton, RelativeTime, SectionCard, TechnicalDetails } from "./design-system";
import { PageHeader } from "./page-header";
import { useI18n } from "./i18n";

const EXPLORERS = ["https://amoy.polygonscan.com/", "https://polygonscan.com/", "https://sepolia.etherscan.io/", "https://etherscan.io/"];

export function BatchesView() {
  const { t } = useI18n();
  const batches = useResource("GET /api/batches", {});
  const chain = useResource("GET /api/chain", {});
  if (batches.loading || chain.loading) return <PageSkeleton />;
  if (batches.error || chain.error) return <ResourceError error={batches.error || chain.error!} retry={() => { batches.reload(); chain.reload(); }} />;

  const network = chain.data?.network === "local" ? t("net.local") : chain.data?.network === "sepolia" ? t("net.sepolia") : t("net.polygon", { name: chain.data?.network ?? "" });

  return (
    <div className="page-grid">
      <PageHeader
        title={t("bat.title")}
        description={t("bat.sub")}
        action={<Button onClick={() => { batches.reload(); chain.reload(); }}><RefreshCw />{t("bat.refresh")}</Button>}
      />
      <SectionCard title={t("bat.batches")}>
        <DataTable
          rows={batches.data?.items ?? []}
          rowKey={b => String(b.batchId)}
          searchText={b => String(b.batchId) + " " + b.status}
          searchLabel={t("bat.find")}
          columns={[
            { key: "batch", label: t("col.batch"), sort: b => b.batchId, render: b => <span className="font-semibold">{t("bat.name", { id: b.batchId })}</span> },
            { key: "count", label: t("col.documents"), sort: b => b.documentCount, render: b => b.documentCount },
            {
              key: "status",
              label: t("col.status"),
              sort: b => b.status,
              render: b => (
                <span className={"status-pill " + (b.status === "confirmed" ? "tone-info" : "tone-pending")}>
                  {b.status === "confirmed" ? <Check className="size-3" /> : <Clock className="size-3" />}
                  {t(b.status === "confirmed" ? "bat.sealed" : "bat.sealing")}
                </span>
              ),
            },
            { key: "time", label: t("col.sealed"), sort: b => b.anchoredAt ?? "", render: b => <RelativeTime at={b.anchoredAt} /> },
            {
              key: "proof",
              label: t("col.proof"),
              render: b => (
                <details>
                  <summary className="cursor-pointer text-primary">{t("bat.show")}</summary>
                  <div className="space-y-2 py-3">
                    <div><p className="section-label">{t("bat.root")}</p><CopyableHash value={b.root} /></div>
                    <div><p className="section-label">{t("bat.signature")}</p><CopyableHash value={b.signatureHash} /></div>
                    <div><p className="section-label">{t("bat.tx")}</p><CopyableHash value={b.txHash} /></div>
                    {b.explorerUrl && EXPLORERS.some(prefix => b.explorerUrl!.startsWith(prefix))
                      ? <a className="text-sm text-primary underline" href={b.explorerUrl} target="_blank" rel="noreferrer">{t("bat.explorer")}</a>
                      : <p className="text-sm text-muted-foreground">{t("net.local")}</p>}
                  </div>
                </details>
              ),
            },
          ]}
        />
      </SectionCard>
      <TechnicalDetails title={t("bat.registry")}>
        <div className="grid gap-4 sm:grid-cols-3">
          <div><p className="section-label">{t("bat.network")}</p><p className="font-medium">{network}</p></div>
          <div><p className="section-label">{t("bat.chainId")}</p><p>{chain.data?.chainId}</p></div>
          <div><p className="section-label">{t("bat.address")}</p><CopyableHash value={chain.data?.registryAddress ?? null} label={t("bat.address")} /></div>
        </div>
      </TechnicalDetails>
    </div>
  );
}
