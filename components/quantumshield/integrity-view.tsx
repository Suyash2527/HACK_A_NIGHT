"use client";
import Link from "next/link";
import { useState } from "react";
import { Play } from "lucide-react";
import { toast } from "sonner";
import type { ScanDetail } from "@/types/api";
import { api } from "@/components/api-client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { PageHeader } from "./page-header";
import { DataTable, EmptyState, InlineNotice, RelativeTime, SectionCard } from "./design-system";
import { StatusBadge } from "./status-badge";
import { IntegrityPanel } from "./integrity-panel";
import { useI18n } from "./i18n";

const FILTERS = ["ALL", "TAMPERED", "VERIFIED", "PENDING_ANCHOR", "UNANCHORED", "ERROR"] as const;
const SCAN_CONCURRENCY = 3;

export function IntegrityView() {
  const { t, label } = useI18n();
  const [scan, setScan] = useState<ScanDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");

  // The server checks at most 150 documents per request, so the whole register is checked case by case
  // (a few cases at a time) and the results are combined into one report.
  async function run() {
    setBusy(true);
    setError("");
    setProgress(null);
    try {
      const cases: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await api("GET /api/cases", { query: { limit: 100, cursor } });
        cases.push(...page.items.map(c => c.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);

      const startedAt = new Date().toISOString();
      const results: ScanDetail["results"] = [];
      let checked = 0, total = 0, done = 0;
      const queue = [...cases];
      async function worker() {
        for (let id = queue.shift(); id; id = queue.shift()) {
          const part = await api("POST /api/integrity/scans", { body: { caseId: id } });
          results.push(...part.results);
          checked += part.checked;
          total += part.total;
          setProgress({ done: ++done, of: cases.length });
        }
      }
      await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, worker));
      setScan({ id: "combined", status: "completed", checked, total, startedAt, completedAt: new Date().toISOString(), results });
      toast.info(t("chk.done"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("chk.failed"));
      toast.error(t("chk.failed"));
    } finally {
      setBusy(false);
    }
  }

  const findings = scan?.results ?? [];
  const incidents = findings.filter(r => r.verification.status === "TAMPERED");
  const unchanged = findings.filter(r => r.verification.status === "VERIFIED").length;

  return (
    <div className="page-grid">
      <PageHeader
        title={t("chk.title")}
        description={t("chk.sub")}
        action={<Button onClick={() => void run()} disabled={busy}><Play />{busy ? t("chk.running") : t("chk.run")}</Button>}
      />
      {busy && <InlineNotice>{progress ? t("chk.progress", { done: progress.done, of: progress.of }) : t("chk.wait")}</InlineNotice>}
      {error && <InlineNotice danger>{t("chk.stale", { error })}</InlineNotice>}
      {scan?.error && <InlineNotice danger>{scan.error.message}</InlineNotice>}
      {scan && (
        <InlineNotice danger={incidents.length > 0}>
          {t("chk.summary", { checked: scan.checked, total: scan.total, ok: unchanged, bad: incidents.length })}
        </InlineNotice>
      )}
      {incidents.map(item => (
        <section key={item.document.id} className="tone-danger border p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="section-label !text-tampered">{t("chk.incident")}</p>
              <h2 className="mt-2 break-all text-lg font-semibold">{item.document.filename}</h2>
            </div>
            <StatusBadge status="TAMPERED" />
          </div>
          {item.verification.tamperRanges.map(r => (
            <p key={r.chunkIndex} className="mt-3 font-mono text-sm text-tampered">{t("int.range", { i: r.chunkIndex, a: r.byteStart, b: r.byteEnd })}</p>
          ))}
          <p className="my-3 text-sm text-muted-foreground">
            {t("chk.recent", { names: item.verification.lastAccessors.map(a => a.actorName).join(" · ") || t("chk.unavailable") })}
          </p>
          <Button asChild><Link href={"/documents/" + item.document.id}>{t("chk.review")}</Link></Button>
        </section>
      ))}
      <SectionCard title={t("chk.results")} action={scan && <RelativeTime at={scan.completedAt} />}>
        <div className="mb-4 flex flex-wrap gap-2">
          {FILTERS.map(f => (
            <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === "ALL" ? t("common.all") : f === "TAMPERED" ? t("chk.attention") : label(f)}
            </Button>
          ))}
        </div>
        {scan ? (
          <DataTable
            rows={findings.filter(r => filter === "ALL" || r.verification.status === filter)}
            rowKey={r => r.document.id}
            searchText={r => r.document.filename}
            searchLabel={t("chk.find")}
            columns={[
              { key: "name", label: t("col.document"), sort: r => r.document.filename, render: r => <Link className="text-primary" href={"/documents/" + r.document.id}>{r.document.filename}</Link> },
              { key: "status", label: t("col.result"), sort: r => r.verification.status, render: r => <StatusBadge status={r.verification.status} /> },
              {
                key: "checks",
                label: t("col.details"),
                render: r => (
                  <Sheet>
                    <SheetTrigger asChild><Button variant="outline">{t("chk.see")}</Button></SheetTrigger>
                    <SheetContent className="w-full overflow-y-auto p-5 sm:max-w-xl">
                      <SheetHeader>
                        <SheetTitle>{r.document.filename}</SheetTitle>
                        <SheetDescription>{t("chk.sheetDesc")}</SheetDescription>
                      </SheetHeader>
                      <div className="mt-5">
                        <IntegrityPanel result={r.verification} documentName={r.document.filename} />
                        <Button asChild variant="outline" className="mt-4"><Link href={"/documents/" + r.document.id}>{t("chk.openDoc")}</Link></Button>
                      </div>
                    </SheetContent>
                  </Sheet>
                ),
              },
            ]}
          />
        ) : (
          <EmptyState title={t("chk.empty")} description={t("chk.emptyHelp")} />
        )}
      </SectionCard>
    </div>
  );
}
