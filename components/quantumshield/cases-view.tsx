"use client";
import Link from "next/link";
import { useState } from "react";
import { Plus, ArrowRight, Copy } from "lucide-react";
import { toast } from "sonner";
import type { CaseDetail, CaseSummary, VerifyStatus, CreateCaseRequest } from "@/types/api";
import { apiFetch, USE_MOCKS } from "@/components/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { MOCK_CASES, mockRegisterCase, rememberMockCase } from "./offline-demo-data";
import { useSession } from "./session";
import { useResource } from "./use-resource";
import { ResourceError } from "./access-state";
import { PageHeader } from "./page-header";
import { SectionCard, DataTable, PageSkeleton, RelativeTime, humanize } from "./design-system";
import { FirNumber } from "./fir-number";
import { FirCheckBox } from "./fir-check";
import { StatusBadge } from "./status-badge";
function caseStatus(c: CaseSummary): VerifyStatus | null { const x = c.integrity; return x.TAMPERED ? "TAMPERED" : x.ERROR ? "ERROR" : x.PENDING_ANCHOR ? "PENDING_ANCHOR" : x.UNANCHORED ? "UNANCHORED" : c.documentCount > 0 && x.VERIFIED === c.documentCount ? "VERIFIED" : null; }
export function CasesView() {
    const session = useSession();
    const resource = useResource("GET /api/cases", { query: { limit: 100 }, mock: MOCK_CASES });
    const [stage, setStage] = useState(""), [station, setStation] = useState(""), [integrity, setIntegrity] = useState(""), [attentionOnly, setAttentionOnly] = useState(false);
    if (resource.loading)
        return <PageSkeleton />;
    if (resource.error || !resource.data)
        return <ResourceError error={resource.error || new Error("No cases")} retry={resource.reload}/>;
    const all = resource.data.items;
    const attention = all.filter(c => c.integrity.TAMPERED || c.integrity.ERROR || c.integrity.unchecked);
    const rows = all.filter(c => (!stage || c.stage === stage) && (!station || c.station === station) && (!integrity || (integrity === "UNCHECKED" ? c.integrity.unchecked > 0 : caseStatus(c) === integrity)) && (!attentionOnly || attention.includes(c)));
    return <div className="page-grid"><PageHeader title={session.user.role === "POLICE" ? "My cases" : session.user.role === "FORENSIC_LAB" ? "Assigned cases" : "Case register"} description="FIR register and document integrity." breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Cases" }]} action={session.canCreateCase && <CreateCase onCreated={c => resource.setData(current => current ? { ...current, items: [c, ...current.items.filter(item => item.id !== c.id)] } : { items: [c], nextCursor: null })}/>}/><div className="flex flex-wrap items-center justify-between gap-2 border px-3 py-2 text-xs"><span><span className={attention.length ? "text-tampered" : "text-muted-foreground"}>Needs attention: {attention.length} cases</span> · {all.reduce((n, c) => n + c.integrity.TAMPERED, 0)} tampered documents · {all.reduce((n, c) => n + c.integrity.unchecked, 0)} unchecked</span><button className="filter-chip" aria-pressed={attentionOnly} onClick={() => setAttentionOnly(v => !v)}>{attentionOnly ? "Show all" : "Show attention"}</button></div><div className="no-print flex flex-wrap gap-2" aria-label="Case filters"><FilterChip label="Stage" value={stage} onChange={setStage} options={Array.from(new Set(all.map(c => c.stage))).map(value => ({ value, label: humanize(value) }))}/><FilterChip label="Station" value={station} onChange={setStation} options={Array.from(new Set(all.map(c => c.station))).map(value => ({ value, label: value }))}/><FilterChip label="Integrity" value={integrity} onChange={setIntegrity} options={["VERIFIED", "TAMPERED", "PENDING_ANCHOR", "UNANCHORED", "ERROR", "UNCHECKED"].map(value => ({ value, label: humanize(value) }))}/>{(stage || station || integrity || attentionOnly) && <Button variant="ghost" size="sm" onClick={() => { setStage(""); setStation(""); setIntegrity(""); setAttentionOnly(false); }}>Clear filters</Button>}</div><SectionCard><DataTable rows={rows} resetKey={[stage, station, integrity, attentionOnly].join("|")} rowKey={c => c.id} searchText={c => c.firNo + " " + c.station} searchLabel="Search FIR No. or Station" columns={[
            { key: "fir", label: "FIR No.", sort: c => c.firNo, render: c => <Link href={"/cases/" + c.id} className="text-[#b45309]"><FirNumber value={c.firNo}/></Link> },
            { key: "station", label: "Police Station", sort: c => c.station, render: c => c.station },
            { key: "stage", label: "Stage", sort: c => c.stage, render: c => humanize(c.stage) },
            { key: "files", label: "Documents", sort: c => c.documentCount, render: c => <span className="font-mono">{c.documentCount}</span> },
            { key: "status", label: "Integrity", sort: c => caseStatus(c) ?? "UNCHECKED", render: c => <StatusBadge status={caseStatus(c)}/> },
            { key: "created", label: "Filed on", sort: c => c.createdAt, render: c => <RelativeTime at={c.createdAt}/> }
        ]}/></SectionCard><FirCheckBox /></div>;
}
function FilterChip({ label, value, onChange, options }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: {
        value: string;
        label: string;
    }[];
}) { return <label className="filter-chip flex items-center gap-2" style={value ? { borderColor: "#b45309" } : undefined}><span>{label}</span><select aria-label={label} value={value} onChange={e => onChange(e.target.value)} className="max-w-56 border-0 text-xs"><option value="">All</option>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>; }
export function CreateCase({ onCreated }: {
    onCreated: (c: CaseDetail) => void;
}) {
    const session = useSession();
    const [open, setOpen] = useState(false), [email, setEmail] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [created, setCreated] = useState<CaseDetail | null>(null);
    async function submit(event: React.FormEvent) { event.preventDefault(); if (busy || created)
        return; setBusy(true); setError(""); const body: CreateCaseRequest = email.trim() ? { complainantEmail: email.trim() } : {}; try {
        const c = await apiFetch("POST /api/cases", { body, mock: USE_MOCKS ? mockRegisterCase(session) : undefined });
        if (USE_MOCKS)
            rememberMockCase(c);
        setCreated(c);
        toast.success("Case registered", { description: c.firNo });
    }
    catch (e) {
        setError(e instanceof Error ? e.message : "Could not register case");
        toast.error("Case registration failed");
    }
    finally {
        setBusy(false);
    } }
    function changeOpen(next: boolean) { if (busy)
        return; if (!next && created)
        onCreated(created); if (next) {
        setCreated(null);
        setEmail("");
        setError("");
    } setOpen(next); }
    async function copy() { if (!created)
        return; try {
        await navigator.clipboard.writeText(created.firNo);
        toast.success("FIR number copied");
    }
    catch {
        toast.error("Could not copy. Select the assigned number to copy it manually.");
    } }
    return <Dialog open={open} onOpenChange={changeOpen}><DialogTrigger asChild><Button><Plus />Register case</Button></DialogTrigger><DialogContent showCloseButton={!busy}><DialogHeader><DialogTitle>{created ? "Case registered" : "Register case"}</DialogTitle><DialogDescription>{created ? "Keep this assigned FIR number for future reference." : "Sakshya assigns the FIR number. Your station comes from your signed-in account; neither can be entered or edited here."}</DialogDescription></DialogHeader>{created ? <div className="space-y-4" role="status"><div className="rounded-lg border bg-muted/40 p-4"><p className="section-label mb-2">Assigned FIR number</p><div className="flex flex-wrap items-center gap-2"><FirNumber value={created.firNo}/><Button variant="ghost" size="icon-sm" aria-label="Copy assigned FIR number" onClick={() => void copy()}><Copy /></Button></div><p className="mt-3 text-xs text-muted-foreground">Assigned by Sakshya · verification code {created.firNo.split("/").at(-1)}</p><p className="mt-2 text-sm">{created.station}</p></div>{USE_MOCKS && <p className="text-xs text-muted-foreground">Demo assignment only. No live FIR register was changed.</p>}<DialogFooter><Button onClick={() => changeOpen(false)}>Done</Button><Button asChild variant="outline"><Link href={"/cases/" + created.id} onClick={() => changeOpen(false)}>Open case<ArrowRight /></Link></Button></DialogFooter></div> : <form className="space-y-4" onSubmit={submit}><div className="rounded-lg bg-muted/40 p-3 text-sm"><p className="section-label">Registering station</p>{session.user.station}</div><div className="space-y-2"><Label htmlFor="complainant-email">Complainant email (optional)</Label><Input id="complainant-email" type="email" autoComplete="email" value={email} disabled={busy} onChange={e => setEmail(e.target.value)}/></div>{error && <p role="alert" className="text-sm text-tampered">{error}</p>}<DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => changeOpen(false)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Registering…" : "Register case"}</Button></DialogFooter></form>}</DialogContent></Dialog>;
}
