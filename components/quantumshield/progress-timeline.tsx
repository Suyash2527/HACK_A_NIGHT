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
import { PageSkeleton, SectionCard, Timeline, TimelineItem, humanize } from "./design-system";
export function ProgressTimeline({ caseId }: {
    caseId: string;
}) {
    const session = useSession();
    const resource = useResource("GET /api/cases/[id]/progress", { params: { id: caseId } });
    if (resource.loading)
        return <PageSkeleton />;
    if (resource.error)
        return <ResourceError error={resource.error} retry={resource.reload}/>;
    const data = resource.data;
    if (!data)
        return null;
    const canAdd = ["POLICE", "JUDGE"].includes(session.user.role);
    return <div className="page-grid"><PageHeader title={<>Progress · <FirNumber value={data.firNo}/></>} description={data.station + " · Public-safe updates from the investigating team and court."} breadcrumbs={[{ label: "Case progress" }, { label: <FirNumber value={data.firNo}/> }]} action={canAdd && <AddMilestone data={data} onComplete={resource.setData}/>}/><SectionCard title="Case milestones" description={"Current stage: " + humanize(data.currentStage)}><Timeline>{CASE_STAGES.map(stage => { const updates = data.milestones.filter(m => m.stage === stage); return <TimelineItem key={stage} title={humanize(stage) + (stage === data.currentStage ? " · Current" : "")} detail={!updates.length ? "Not reached" : undefined}>{updates.map((m, i) => <div className="mt-3 rounded-lg bg-muted/40 p-3" key={i}><Timeline><TimelineItem title="Progress update" at={m.at} detail={m.note ?? "Stage recorded by the authorized team."}/></Timeline></div>)}</TimelineItem>; })}</Timeline><p className="mt-6 border-t pt-4 text-sm text-muted-foreground">{data.nextExpectedStage ? "Next expected: " + humanize(data.nextExpectedStage) + ". " : "No further stage scheduled. "}For questions, contact the investigating station. Evidence and private identities are not shown here.</p></SectionCard></div>;
}
function AddMilestone({ data, onComplete }: {
    data: CaseProgress;
    onComplete: (v: CaseProgress) => void;
}) {

    const [open, setOpen] = useState(false), [stage, setStage] = useState<CaseStage>(data.nextExpectedStage ?? data.currentStage), [note, setNote] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
    async function submit() {
        setBusy(true);
        setError("");
        try {
            const next = await api("POST /api/cases/[id]/milestones", { params: { id: data.caseId }, body: { stage, note: note.trim() || undefined } });
            onComplete(next);
            setOpen(false);
            setNote("");
            toast.success("Milestone recorded");
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "Could not record milestone");
            toast.error("Milestone was not saved");
        }
        finally {
            setBusy(false);
        }
    }
    return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button><Plus />Add milestone</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Add public-safe update</DialogTitle><DialogDescription>The complainant sees this note. Do not include evidence, hashes or private identities.</DialogDescription></DialogHeader><Label htmlFor="milestone-stage">Case stage</Label><select id="milestone-stage" className="h-11 rounded border bg-background px-3" value={stage} onChange={e => setStage(e.target.value as CaseStage)}>{CASE_STAGES.map(s => <option key={s} value={s}>{humanize(s)}</option>)}</select><Label htmlFor="milestone-note">Public-safe note</Label><Textarea id="milestone-note" value={note} onChange={e => setNote(e.target.value)} maxLength={1500}/>{error && <p role="alert" className="text-sm text-tampered">{error}</p>}<DialogFooter showCloseButton><Button disabled={busy} onClick={() => void submit()}>{busy ? "Recording…" : "Record milestone"}</Button></DialogFooter></DialogContent></Dialog>;
}
