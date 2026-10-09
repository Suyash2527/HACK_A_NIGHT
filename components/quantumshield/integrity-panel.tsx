"use client";
import { useState, type CSSProperties, type ReactNode } from "react";
import { Check, CircleHelp, CircleMinus, ExternalLink, LockKeyhole, RotateCcw, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";
import type { CheckStatus, VerifyResult, VerifyStatus } from "@/types/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CopyableHash, ExplainTerm, TechnicalDetails, Timeline, TimelineItem } from "./design-system";
import { useI18n } from "./i18n";

const CHECKS = ["decrypt", "plaintextHash", "chunkRoot", "signature", "merkleProof", "onChainRoot"] as const;
const EXPLORERS = ["https://amoy.polygonscan.com/", "https://polygonscan.com/", "https://sepolia.etherscan.io/", "https://etherscan.io/"];

const STATUS_ICON = { pass: Check, fail: X, skip: CircleMinus };
const TONE: Record<VerifyStatus, "verified" | "danger" | "pending" | "neutral"> = {
  VERIFIED: "verified", TAMPERED: "danger", ERROR: "danger", PENDING_ANCHOR: "pending", UNANCHORED: "neutral",
};

/** The verdict as an office rubber stamp: "Verified" large, the plain meaning small beneath. */
function VerdictStamp({ status }: { status: VerifyStatus }) {
  const { label } = useI18n();
  const [main, meaning] = label(status).split(" · ");
  const tone = { verified: "tone-verified", danger: "tone-danger", pending: "tone-pending", neutral: "tone-neutral" }[TONE[status]];
  return (
    <div className={"stamp " + tone} role="img" aria-label={label(status)}>
      {main}
      {meaning && <small>{meaning}</small>}
    </div>
  );
}

export function IntegrityPanel({ result, canRestore = false, documentName, onRestore, extra }: {
  result: VerifyResult;
  canRestore?: boolean;
  documentName?: string;
  onRestore?: (reason: string) => Promise<void>;
  /** Extra proof the host page wants inside the same collapsed section. */
  extra?: ReactNode;
}) {
  const { t, label } = useI18n();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function restore() {
    if (!reason.trim()) {
      setError(t("int.needReason"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (!onRestore) throw new Error(t("int.restoreUnavailable"));
      await onRestore(reason.trim());
      setOpen(false);
      setReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("int.restoreFailed"));
      toast.error(t("int.restoreToast"));
    } finally {
      setBusy(false);
    }
  }

  const tone = (status: CheckStatus) =>
    status === "fail" ? "tone-danger" : status === "skip" ? "tone-neutral" : result.status === "VERIFIED" ? "tone-verified" : "tone-info";
  const tampered = result.status === "TAMPERED";
  const explorer = result.anchor?.explorerUrl;
  const safeExplorer = explorer && EXPLORERS.some(prefix => explorer.startsWith(prefix));

  const restoreAction = tampered && result.originalVersionAvailable && (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button disabled={!canRestore || !onRestore} title={!canRestore ? t("int.contributorOnly") : undefined} variant="outline" className="no-print">
          <RotateCcw />{t("int.restore")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("int.restoreTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("int.restoreDesc")}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="restore-reason">{t("int.restoreReason")}</Label>
          <Input id="restore-reason" value={reason} onChange={e => setReason(e.target.value)} aria-invalid={!!error} aria-describedby={error ? "restore-error" : undefined} placeholder={t("int.restoreHint")} />
          {error && <p id="restore-error" role="alert" className="text-sm text-tampered">{error}</p>}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t("int.keep")}</AlertDialogCancel>
          <Button onClick={() => void restore()} disabled={busy}>{busy ? t("int.submitting") : t("int.confirm")}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return (
    <div className="space-y-5" aria-label={t("int.aria")}>
      <section className="verdict" data-tone={TONE[result.status]}>
        <div className="min-w-0">
          <h2 className="text-xl font-bold">{tampered ? t("int.incident") : t("int.result")}</h2>
          {documentName && tampered && <p className="mt-1 break-words text-base font-medium">{documentName}</p>}
          <p className="mt-2 text-lg">{t(`status.desc.${result.status}`)}</p>
        </div>
        <VerdictStamp status={result.status} />
        {tampered && (<div className="sm:col-span-2">
          <>
            <h3 className="mt-4 text-base font-semibold">{t("int.where")}</h3>
            <div className="my-2 space-y-2">
              {result.tamperRanges.length ? result.tamperRanges.map(range => (
                <div className="flex items-start gap-2 border border-tampered/30 bg-card p-3" key={range.chunkIndex}>
                  <ShieldAlert className="mt-0.5 size-4 shrink-0 text-tampered" />
                  <div>
                    <p className="font-mono text-sm font-semibold">{t("int.range", { i: range.chunkIndex, a: range.byteStart, b: range.byteEnd })}</p>
                    <span className="text-sm text-muted-foreground">{label(range.kind)}</span>
                  </div>
                </div>
              )) : <p className="text-base">{t(result.checks.decrypt === "fail" ? "int.noDecrypt" : "int.noRange")}</p>}
            </div>
            <p className="text-sm text-muted-foreground">{t("int.rangeNote")}</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {restoreAction}
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <LockKeyhole className="size-3" />{t(result.originalVersionAvailable ? "int.retained" : "int.noRetained")}
              </span>
            </div>
            {result.originalVersionAvailable && !canRestore && <p className="mt-2 text-sm text-muted-foreground">{t("int.contributorOnly")}</p>}
          </></div>
        )}
      </section>

      <TechnicalDetails title={t("trust.techTitle")} open={result.status === "TAMPERED" || result.status === "ERROR"}>
        {extra}
        <section>
          <h3 className="text-base font-semibold">{t("int.checks")}</h3>
          <p className="mb-2 text-sm text-muted-foreground">{t("int.checksHelp")}</p>
          <TooltipProvider>
            <div className="divide-y">
              {CHECKS.map((key, i) => {
                const status = result.checks[key];
                const Icon = STATUS_ICON[status];
                return (
                  <div key={key} className="check-reveal flex min-h-9 items-center justify-between gap-3 py-2" style={{ "--check-index": i } as CSSProperties}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button className="flex items-center gap-2 text-left text-base" aria-label={t(`ck.${key}`) + ". " + t(`ck.${key}.help`)}>
                          {t(`ck.${key}`)}<CircleHelp className="size-3 shrink-0 text-muted-foreground" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{t(`ck.${key}.help`)}</TooltipContent>
                    </Tooltip>
                    <span className={"status-pill " + tone(status)}><Icon className="size-3" />{t(`ckstatus.${status}`)}</span>
                  </div>
                );
              })}
            </div>
          </TooltipProvider>
        </section>

        {result.parts && (
          <section>
            <h3 className="text-base font-semibold">{t("int.parts")}</h3>
            <p className="mb-2 text-sm text-muted-foreground">{t("int.partsCount", { ok: result.parts.filter(p => p.status === "pass").length, n: result.parts.length })}</p>
            <TooltipProvider>
              <div className="flex flex-wrap gap-2">
                {result.parts.map(part => {
                  const Icon = STATUS_ICON[part.status];
                  return (
                    <Tooltip key={part.index}>
                      <TooltipTrigger asChild>
                        <button className={"flex min-h-11 min-w-12 items-center justify-center gap-1 border px-2 text-sm font-semibold " + tone(part.status)} aria-label={t("int.partName", { i: part.index }) + ": " + t(`ckstatus.${part.status}`)}>
                          <Icon className="size-3" />{part.index}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{t("int.partTip", { i: part.index, a: part.byteStart, b: part.byteEnd })}</p>
                        <p className="hash-value">{part.address}</p>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </TooltipProvider>
            <details className="mt-3 text-sm text-muted-foreground">
              <summary className="cursor-pointer">{t("int.partAddresses")}</summary>
              {result.parts.map(part => (
                <div key={part.index} className="mt-2 flex flex-wrap items-center gap-2">
                  {t("int.partName", { i: part.index })}<CopyableHash value={part.address} label={t("int.partAddresses")} />
                </div>
              ))}
            </details>
          </section>
        )}

        <section>
          <h3 className="text-base font-semibold">{t("int.accessors")}</h3>
          <p className="mb-2 text-sm text-muted-foreground">{t("int.accessorsHelp")}</p>
          {result.lastAccessors.length ? (
            <Timeline>
              {[...result.lastAccessors].sort((a, b) => a.at.localeCompare(b.at)).map((actor, i) => (
                <TimelineItem key={i} title={actor.actorName} detail={label(actor.role) + " · " + label(actor.action)} at={actor.at} />
              ))}
            </Timeline>
          ) : <p className="text-base text-muted-foreground">{t("int.noAccessors")}</p>}
        </section>

        <section>
          <h3 className="text-base font-semibold"><ExplainTerm term={t("int.seal")} meaning={t("int.sealTerm")} /></h3>
          {result.anchor ? (
            <div className="mt-2 space-y-3">
              <p className="text-sm text-muted-foreground">
                {t("int.sealBatch", { id: result.anchor.batchId, status: t(result.anchor.status === "confirmed" ? "bat.sealed" : "bat.sealing") })} · {t(explorer ? "int.public" : "int.localChain")}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><p className="section-label">{t("int.root")}</p><CopyableHash value={result.anchor.root} /></div>
                <div><p className="section-label">{t("int.tx")}</p><CopyableHash value={result.anchor.txHash} /></div>
              </div>
              {safeExplorer && <Button variant="outline" asChild><a href={explorer!} target="_blank" rel="noreferrer">{t("int.viewTx")}<ExternalLink /></a></Button>}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">{t("int.noSealHelp")}</p>
          )}
          <p className="mt-4 border-t pt-3 text-sm leading-6 text-muted-foreground">{t("trust.note")}</p>
        </section>
      </TechnicalDetails>
    </div>
  );
}
