"use client";
import { useState } from "react";
import { Archive, Check, CircleMinus, Download, X } from "lucide-react";
import { toast } from "sonner";
import type { AssemblyReport } from "@/types/api";
import { api } from "@/components/api-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { CopyableHash, InlineNotice, SectionCard, TechnicalDetails } from "./design-system";
import { StatusBadge } from "./status-badge";
import { useI18n } from "./i18n";

export function AssemblyReportDialog({ caseId, disabled = false }: { caseId: string; disabled?: boolean }) {
  const { t } = useI18n();
  const [report, setReport] = useState<AssemblyReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function assemble() {
    setBusy(true);
    setError("");
    try {
      setReport(await api("POST /api/cases/[id]/assemble", { params: { id: caseId } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("asm.failed"));
      toast.error(t("asm.toastFail"));
    } finally {
      setBusy(false);
    }
  }

  // The bundle is offered only when every document, every stored piece and (for a full folder) the seal are verified.
  const complete = !!report
    && report.documents.length > 0
    && report.documents.every(d => d.verification.status === "VERIFIED")
    && report.totals.parts === report.totals.partsVerified
    && (report.scope === "GRANTED_DOCUMENTS" || (report.manifest?.onChain === "pass" && report.manifest.root === report.manifest.recomputed));

  function download() {
    if (report?.bundle && complete) window.location.assign(report.bundle.downloadPath);
  }

  const ready = complete && !!report?.bundle;
  const Icon = (status: "pass" | "fail" | "skip") => status === "pass" ? <Check /> : status === "fail" ? <X /> : <CircleMinus />;

  return (
    <Dialog onOpenChange={open => { if (open) void assemble(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled} title={disabled ? t("asm.disabled") : undefined}><Archive />{t("asm.button")}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("asm.title")}</DialogTitle>
          <DialogDescription>{t("asm.desc")}</DialogDescription>
        </DialogHeader>
        {busy && <InlineNotice>{t("asm.checking")}</InlineNotice>}
        {error && <InlineNotice danger>{error}<Button variant="outline" onClick={() => void assemble()}>{t("asm.retry")}</Button></InlineNotice>}
        {report && (
          <div className="space-y-4" aria-live="polite">
            <SectionCard title={t("asm.pieces", { ok: report.totals.partsVerified, n: report.totals.parts })} description={t(report.scope === "FULL_CASE" ? "asm.scopeFull" : "asm.scopeGranted")}>
              <Progress aria-label={t("asm.progressAria")} value={report.totals.parts ? report.totals.partsVerified / report.totals.parts * 100 : 0} />
            </SectionCard>
            {report.documents.map(item => (
              <SectionCard key={item.document.id} title={item.document.filename} action={<StatusBadge status={item.verification.status} />}>
                <p className="text-sm text-muted-foreground">
                  {t("asm.pieces", { ok: item.verification.parts?.filter(p => p.status === "pass").length ?? 0, n: item.verification.parts?.length ?? item.document.partCount })}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.verification.parts?.map(p => (
                    <span key={p.index} title={t("int.partTip", { i: p.index, a: p.byteStart, b: p.byteEnd })} className={"status-pill " + (p.status === "fail" ? "tone-danger" : p.status === "skip" ? "tone-neutral" : item.verification.status === "VERIFIED" ? "tone-verified" : "tone-info")}>
                      {Icon(p.status)}{t("int.partName", { i: p.index })}
                    </span>
                  ))}
                </div>
              </SectionCard>
            ))}
            {report.manifest && (
              <TechnicalDetails title={t("asm.version", { v: report.manifest.version })}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><p className="section-label">{t("asm.sealed")}</p><CopyableHash value={report.manifest.root} /></div>
                  <div><p className="section-label">{t("asm.recomputed")}</p><CopyableHash value={report.manifest.recomputed} /></div>
                </div>
                <p className="flex items-center gap-2 text-sm">{Icon(report.manifest.onChain)}{t("asm.chain", { result: t(`ckstatus.${report.manifest.onChain}`) })}</p>
                {report.bundle && <div><p className="section-label">{t("asm.bundleHash")}</p><CopyableHash value={report.bundle.sha256} /></div>}
              </TechnicalDetails>
            )}
            <Button onClick={download} disabled={!ready}><Download />{t(ready ? "asm.download" : "asm.withheld")}</Button>
            {!ready && <p className="text-sm text-muted-foreground">{t("asm.withheldHelp")}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
