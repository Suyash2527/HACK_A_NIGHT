"use client";
import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, Play, ScanSearch, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import type { ScanDetail } from "@/types/api";
import { api } from "@/components/api-client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { PageHeader } from "./page-header";
import { DataTable, EmptyState, InlineNotice, RelativeTime, SectionCard, StatCard } from "./design-system";
import { StatusBadge } from "./status-badge";
import { IntegrityPanel } from "./integrity-panel";
export function IntegrityView() {
    const [scan, setScan] = useState<ScanDetail | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [filter, setFilter] = useState("ALL");
    async function run() {
        setBusy(true);
        setError("");
        try {
            setScan(await api("POST /api/integrity/scans", { body: {} }));
            toast.info("Integrity scan completed");
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "Scan failed");
            toast.error("Scan could not complete");
        }
        finally {
            setBusy(false);
        }
    }
    const findings = scan?.results ?? [];
    const incidents = findings.filter(r => r.verification.status === "TAMPERED");
    return <div className="page-grid"><PageHeader eyebrow="Evidence assurance" title="Integrity monitor" description="Find changed evidence, inspect the exact range and recover a protected original." action={<Button onClick={() => void run()} disabled={busy}><Play />{busy ? "Scanning…" : "Run integrity scan"}</Button>}/>{busy && <InlineNotice>Verification is running. Results below remain from the previous scan until the server returns.</InlineNotice>}{error && <InlineNotice danger>{error} Previous results are retained and may be stale.</InlineNotice>}{scan?.error && <InlineNotice danger>{scan.error.message}</InlineNotice>}<div className="grid gap-4 sm:grid-cols-3"><StatCard label="Documents checked" value={scan?.checked ?? 0} detail={scan ? "Of " + scan.total + " permitted documents" : "Run a scan to begin"} icon={<ScanSearch className="size-5"/>}/><StatCard label="Verified evidence" value={findings.filter(r => r.verification.status === "VERIFIED").length} detail="All six checks complete" icon={<CheckCircle2 className="size-5"/>}/><StatCard label="Integrity incidents" value={incidents.length} detail="Review before using in court" danger={incidents.length > 0} icon={<ShieldAlert className="size-5"/>}/></div>{incidents.map(item => <section key={item.document.id} className="rounded-xl border border-tampered/30 bg-tampered-surface p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="section-label !text-tampered">Integrity incident</p><h2 className="mt-2 break-all text-lg font-semibold">{item.document.filename}</h2></div><StatusBadge status="TAMPERED"/></div>{item.verification.tamperRanges.map(r => <p key={r.chunkIndex} className="mt-3 font-mono text-sm text-tampered">chunk {r.chunkIndex}, bytes {r.byteStart}–{r.byteEnd}</p>)}<p className="my-3 text-xs text-muted-foreground">Recent access: {item.verification.lastAccessors.map(a => a.actorName).join(" · ") || "Not available"}. Access history does not establish responsibility.</p><Button asChild><Link href={"/documents/" + item.document.id}>Review incident &amp; restore original</Link></Button></section>)}<SectionCard title="Latest findings" action={scan && <RelativeTime at={scan.completedAt}/>}><div className="mb-4 flex flex-wrap gap-2">{["ALL", "TAMPERED", "VERIFIED", "PENDING_ANCHOR", "UNANCHORED", "ERROR"].map(f => <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === "ALL" ? "All" : f === "TAMPERED" ? "Needs attention" : f.toLowerCase().replaceAll("_", " ")}</Button>)}</div>{scan ? <DataTable rows={findings.filter(r => filter === "ALL" || r.verification.status === filter)} rowKey={r => r.document.id} searchText={r => r.document.filename} searchLabel="Find evidence" columns={[{ key: "name", label: "Document", sort: r => r.document.filename, render: r => <Link className="text-primary" href={"/documents/" + r.document.id}>{r.document.filename}</Link> }, { key: "status", label: "Result", sort: r => r.verification.status, render: r => <StatusBadge status={r.verification.status}/> }, { key: "checks", label: "Details", render: r => <Sheet><SheetTrigger asChild><Button variant="outline">View six checks</Button></SheetTrigger><SheetContent className="w-full overflow-y-auto p-5 sm:max-w-xl"><SheetHeader><SheetTitle>{r.document.filename}</SheetTitle><SheetDescription>Recorded verification result</SheetDescription></SheetHeader><div className="mt-5"><IntegrityPanel result={r.verification} documentName={r.document.filename}/><Button asChild variant="outline" className="mt-4"><Link href={"/documents/" + r.document.id}>Open evidence record</Link></Button></div></SheetContent></Sheet> }]}/> : <EmptyState title="No scan in this session" description="Run an integrity scan to check the evidence you are authorized to inspect."/>}</SectionCard></div>;
}
