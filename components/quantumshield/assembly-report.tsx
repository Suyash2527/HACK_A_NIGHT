"use client";
import { useState } from "react";
import { Archive, Check, CircleMinus, Download, X } from "lucide-react";
import { toast } from "sonner";
import type { AssemblyReport } from "@/types/api";
import { apiFetch, USE_MOCKS } from "@/components/api-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { MOCK_ASSEMBLY } from "./offline-demo-data";
import { CopyableHash, InlineNotice, SectionCard } from "./design-system";
import { StatusBadge } from "./status-badge";
export function AssemblyReportDialog({ caseId = MOCK_ASSEMBLY.caseId, disabled = false }: {
    caseId?: string;
    disabled?: boolean;
}) {
    const [report, setReport] = useState<AssemblyReport | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
    async function assemble() { setBusy(true); setError(""); try {
        setReport(await apiFetch("POST /api/cases/[id]/assemble", { params: { id: caseId }, mock: caseId === MOCK_ASSEMBLY.caseId ? MOCK_ASSEMBLY : undefined }));
    }
    catch (e) {
        setError(e instanceof Error ? e.message : "Assembly failed");
        toast.error("Case folder could not be assembled");
    }
    finally {
        setBusy(false);
    } }
    const complete = !!report && report.documents.length > 0 && report.documents.every(d => d.verification.status === "VERIFIED") && report.totals.parts === report.totals.partsVerified && report.manifest?.onChain === "pass" && report.manifest.root === report.manifest.recomputed;
    async function download() { if (!report?.bundle || !complete)
        return; if (USE_MOCKS) {
        toast.info("Demo bundle: no evidence archive is downloaded");
        return;
    } try {
        const url = new URL(report.bundle.downloadPath, window.location.origin);
        const blob = await apiFetch("GET /api/cases/[id]/bundle", { params: { id: caseId }, query: { token: url.searchParams.get("token") ?? "" } });
        const href = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = href;
        a.download = "Sakshya-case-bundle.zip";
        a.click();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
    }
    catch (e) {
        toast.error(e instanceof Error ? e.message : "Download failed");
    } }
    return <Dialog onOpenChange={open => { if (open)
        void assemble(); }}><DialogTrigger asChild><Button variant="outline" disabled={disabled} title={disabled ? "Available to assigned prosecutors, judges and administrators" : undefined}><Archive />Assemble case folder</Button></DialogTrigger><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Case folder assembly</DialogTitle><DialogDescription>Every document and encrypted part must pass before a court bundle is released.</DialogDescription></DialogHeader>{busy && <InlineNotice>Verifying permitted evidence parts. Waiting for the assembly report…</InlineNotice>}{error && <InlineNotice danger>{error}<Button variant="outline" onClick={() => void assemble()}>Retry assembly</Button></InlineNotice>}{report && <div className="space-y-4" aria-live="polite"><SectionCard title={report.totals.partsVerified + "/" + report.totals.parts + " parts verified"} description={report.scope === "FULL_CASE" ? "Full case folder" : "Court-granted documents only"}><Progress aria-label="Verified storage parts" value={report.totals.parts ? report.totals.partsVerified / report.totals.parts * 100 : 0}/></SectionCard>{report.manifest && <SectionCard title={"Manifest v" + report.manifest.version}><div className="grid gap-3 sm:grid-cols-2"><div><p className="section-label">Sealed root</p><CopyableHash value={report.manifest.root}/></div><div><p className="section-label">Recomputed root</p><CopyableHash value={report.manifest.recomputed}/></div></div><p className="mt-3 flex items-center gap-2 text-xs">{report.manifest.onChain === "pass" ? <Check className="size-4 text-primary"/> : report.manifest.onChain === "fail" ? <X className="size-4 text-tampered"/> : <CircleMinus className="size-4"/>}On-chain comparison: {report.manifest.onChain}</p></SectionCard>}{report.documents.map(item => <SectionCard key={item.document.id} title={item.document.filename} action={<StatusBadge status={item.verification.status}/>}><p className="text-xs text-muted-foreground">{item.verification.parts?.filter(p => p.status === "pass").length ?? 0}/{item.verification.parts?.length ?? item.document.partCount} parts verified</p><div className="mt-3 flex flex-wrap gap-2">{item.verification.parts?.map(p => <span key={p.index} title={"Bytes " + p.byteStart + "–" + p.byteEnd + " · " + p.address} className={"status-pill " + (p.status === "fail" ? "tone-danger" : p.status === "skip" ? "tone-neutral" : item.verification.status === "VERIFIED" ? "tone-verified" : "tone-info")}>{p.status === "pass" ? <Check /> : p.status === "fail" ? <X /> : <CircleMinus />}Part {p.index}</span>)}</div></SectionCard>)}{report.bundle && <CopyableHash value={report.bundle.sha256} label="Bundle hash"/>}<Button onClick={() => void download()} disabled={!complete || !report.bundle}><Download />{complete && report.bundle ? "Download verified bundle" : "Bundle withheld"}</Button>{(!complete || !report.bundle) && <p className="text-xs text-muted-foreground">All documents, parts and the manifest must be verified before download.</p>}</div>}</DialogContent></Dialog>;
}
