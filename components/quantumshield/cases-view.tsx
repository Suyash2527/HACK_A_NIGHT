"use client";
import Link from "next/link";
import { useState } from "react";
import type { CaseSummary, VerifyStatus } from "@/types/api";
import { RegisterFir } from "./register-fir";
import { Button } from "@/components/ui/button";
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
    const resource = useResource("GET /api/cases", { query: { limit: 100 } });
    const [stage, setStage] = useState(""), [station, setStation] = useState(""), [integrity, setIntegrity] = useState(""), [attentionOnly, setAttentionOnly] = useState(false);
    if (resource.loading)
        return <PageSkeleton />;
    if (resource.error || !resource.data)
        return <ResourceError error={resource.error || new Error("No cases")} retry={resource.reload}/>;
    const all = resource.data.items;
    const attention = all.filter(c => c.integrity.TAMPERED || c.integrity.ERROR || c.integrity.unchecked);
    const rows = all.filter(c => (!stage || c.stage === stage) && (!station || c.station === station) && (!integrity || (integrity === "UNCHECKED" ? c.integrity.unchecked > 0 : caseStatus(c) === integrity)) && (!attentionOnly || attention.includes(c)));
    return <div className="page-grid"><PageHeader title={session.user.role === "POLICE" ? "My cases" : session.user.role === "FORENSIC_LAB" ? "Assigned cases" : "Case register"} description="FIR register and document integrity." breadcrumbs={[{ label: "Home", href: "/dashboard" }, { label: "Cases" }]} action={session.canCreateCase && <RegisterFir onCreated={c => resource.setData(current => current ? { ...current, items: [c, ...current.items.filter(item => item.id !== c.id)] } : { items: [c], nextCursor: null })}/>}/><div className="flex flex-wrap items-center justify-between gap-2 border px-3 py-2 text-xs"><span><span className={attention.length ? "text-tampered" : "text-muted-foreground"}>Needs attention: {attention.length} cases</span> · {all.reduce((n, c) => n + c.integrity.TAMPERED, 0)} tampered documents · {all.reduce((n, c) => n + c.integrity.unchecked, 0)} unchecked</span><button className="filter-chip" aria-pressed={attentionOnly} onClick={() => setAttentionOnly(v => !v)}>{attentionOnly ? "Show all" : "Show attention"}</button></div><div className="no-print flex flex-wrap gap-2" aria-label="Case filters"><FilterChip label="Stage" value={stage} onChange={setStage} options={Array.from(new Set(all.map(c => c.stage))).map(value => ({ value, label: humanize(value) }))}/><FilterChip label="Station" value={station} onChange={setStation} options={Array.from(new Set(all.map(c => c.station))).map(value => ({ value, label: value }))}/><FilterChip label="Integrity" value={integrity} onChange={setIntegrity} options={["VERIFIED", "TAMPERED", "PENDING_ANCHOR", "UNANCHORED", "ERROR", "UNCHECKED"].map(value => ({ value, label: humanize(value) }))}/>{(stage || station || integrity || attentionOnly) && <Button variant="ghost" size="sm" onClick={() => { setStage(""); setStation(""); setIntegrity(""); setAttentionOnly(false); }}>Clear filters</Button>}</div><SectionCard><DataTable rows={rows} resetKey={[stage, station, integrity, attentionOnly].join("|")} rowKey={c => c.id} searchText={c => c.firNo + " " + c.station} searchLabel="Search FIR No. or Station" columns={[
            { key: "fir", label: "FIR No.", sort: c => c.firNo, render: c => <Link href={"/cases/" + c.id} className="text-[#c2410c]"><FirNumber value={c.firNo}/></Link> },
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
}) { return <label className="filter-chip flex items-center gap-2" style={value ? { borderColor: "#c2410c" } : undefined}><span>{label}</span><select aria-label={label} value={value} onChange={e => onChange(e.target.value)} className="max-w-56 border-0 text-xs"><option value="">All</option>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>; }
