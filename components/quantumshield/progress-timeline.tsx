"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { CASE_STAGES, type CaseProgress, type CaseStage } from "@/types/api";
import { api } from "@/components/api-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "./session";
import { useResource } from "./use-resource";
import { ResourceError } from "./access-state";
import { FirNumber } from "./fir-number";
import { PageHeader } from "./page-header";
import { PageSkeleton, SectionCard, Timeline, TimelineItem } from "./design-system";
import { useI18n } from "./i18n";

export function ProgressTimeline({ caseId }: { caseId: string }) {
  const { t, label } = useI18n();
  const session = useSession();
  const resource = useResource("GET /api/cases/[id]/progress", { params: { id: caseId } });
  if (resource.loading) return <PageSkeleton />;
  if (resource.error) return <ResourceError error={resource.error} retry={resource.reload} />;
  const data = resource.data;
  if (!data) return null;
  const canAdd = ["POLICE", "JUDGE"].includes(session.user.role);

  return (
    <div className="page-grid">
      <PageHeader
        title={<>{t("prog.crumb")} · <FirNumber value={data.firNo} /></>}
        description={t("prog.sub", { station: data.station, fir: data.firNo })}
        breadcrumbs={[{ label: t("prog.crumb") }, { label: <FirNumber value={data.firNo} /> }]}
        action={canAdd && <AddMilestone data={data} onComplete={resource.setData} />}
      />
      <p className="text-2xl font-medium leading-relaxed">{t(`progress.${data.currentStage}`)}</p>
      <SectionCard title={t("prog.steps")} description={t("prog.current", { stage: label(data.currentStage) })}>
        <Timeline>
          {CASE_STAGES.map(stage => {
            const updates = data.milestones.filter(m => m.stage === stage);
            return (
              <TimelineItem key={stage} title={label(stage) + (stage === data.currentStage ? " · " + t("prog.currentTag") : "")} detail={!updates.length ? t("prog.notReached") : undefined}>
                {updates.map((m, i) => (
                  <div className="mt-3 bg-muted/40 p-3" key={i}>
                    <Timeline><TimelineItem title={t("prog.update")} at={m.at} detail={m.note ?? t("prog.default")} /></Timeline>
                  </div>
                ))}
              </TimelineItem>
            );
          })}
        </Timeline>
        <p className="mt-6 border-t pt-4 text-base text-muted-foreground">
          {data.nextExpectedStage ? t("prog.next", { stage: label(data.nextExpectedStage) }) : t("prog.noNext")} {t("prog.contact")}
        </p>
      </SectionCard>
    </div>
  );
}

function AddMilestone({ data, onComplete }: { data: CaseProgress; onComplete: (v: CaseProgress) => void }) {
  const { t, label } = useI18n();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<CaseStage>(data.nextExpectedStage ?? data.currentStage);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      onComplete(await api("POST /api/cases/[id]/milestones", { params: { id: data.caseId }, body: { stage, note: note.trim() || undefined } }));
      setOpen(false);
      setNote("");
      toast.success(t("prog.saved"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("prog.failed"));
      toast.error(t("prog.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus />{t("prog.add")}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("prog.addTitle")}</DialogTitle>
          <DialogDescription>{t("prog.addDesc")}</DialogDescription>
        </DialogHeader>
        <Label htmlFor="milestone-stage">{t("prog.stage")}</Label>
        <select id="milestone-stage" className="h-11 border bg-background px-3 text-base" value={stage} onChange={e => setStage(e.target.value as CaseStage)}>
          {CASE_STAGES.map(s => <option key={s} value={s}>{label(s)}</option>)}
        </select>
        <Label htmlFor="milestone-note">{t("prog.note")}</Label>
        <Textarea id="milestone-note" value={note} onChange={e => setNote(e.target.value)} maxLength={1500} />
        {error && <p role="alert" className="text-base text-tampered">{error}</p>}
        <DialogFooter showCloseButton>
          <Button disabled={busy} onClick={() => void submit()}>{busy ? t("prog.saving") : t("prog.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
