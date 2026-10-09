"use client";
import { FirNumber } from "./fir-number";
import Link from "next/link";
import { useSession } from "./session";
import { useResource } from "./use-resource";
import { ResourceError } from "./access-state";
import { CopyableHash, DataTable, EmptyState, FileIcon, PageSkeleton, PrintButton, RelativeTime, SectionCard, humanize } from "./design-system";
import { PageHeader } from "./page-header";
import { StatusBadge } from "./status-badge";
import { UploadDialog } from "./upload-dialog";
import { AssemblyReportDialog } from "./assembly-report";
import { formatBytes, roleLabel } from "./format";
import { Button } from "@/components/ui/button";
export function CaseDetailView({ id }: {
    id: string;
}) {
    const session = useSession();
    const record = useResource("GET /api/cases/[id]", { params: { id } });
    const documents = useResource("GET /api/documents", { query: { caseId: id } });
    if (record.loading || documents.loading)
        return <PageSkeleton />;
    if (record.error || documents.error)
        return <ResourceError error={record.error || documents.error!} retry={() => { record.reload(); documents.reload(); }}/>;
    const data = record.data;
    if (!data)
        return <EmptyState title="Case unavailable" description="Return to your cases to find an accessible record."/>;
    const upload = data.canUpload && session.allowedUploadTypes.length > 0;
    return <div className="page-grid"><PageHeader title={<FirNumber value={data.firNo}/>} description={data.station + " · " + humanize(data.stage)} breadcrumbs={[{ label: "Cases", href: "/cases" }, { label: <FirNumber value={data.firNo}/> }]} action={upload ? <UploadDialog caseId={id} allowedTypes={data.allowedUploadTypes} onComplete={documents.reload}/> : <AssemblyReportDialog caseId={id} disabled={!data.canAssemble}/>}/><div className="no-print flex flex-wrap gap-2">{upload && <AssemblyReportDialog caseId={id} disabled={!data.canAssemble}/>}<Button variant="outline" asChild><Link href={"/cases/" + id + "/progress"}>Case progress</Link></Button><PrintButton /></div><SectionCard title="Evidence documents" description="Original records are retained. Corrections create a new version.">{documents.data?.items.length ? <DataTable rows={documents.data.items} rowKey={d => d.id} searchText={d => d.filename + " " + d.type} searchLabel="Find a document" columns={[{ key: "name", label: "Document", sort: d => d.filename, render: d => <div className="flex items-center gap-3"><FileIcon mime={d.mimeType}/><div><Link className="font-medium text-primary hover:underline" href={"/documents/" + d.id}>{d.filename}</Link><p className="text-xs text-muted-foreground">{humanize(d.type)} · v{d.version}</p></div></div> }, { key: "size", label: "Size", sort: d => d.sizeBytes, render: d => formatBytes(d.sizeBytes) }, { key: "date", label: "Filed on", sort: d => d.createdAt, render: d => <RelativeTime at={d.createdAt}/> }, { key: "checked", label: "Last checked", sort: d => d.verifiedAt ?? "", render: d => <RelativeTime at={d.verifiedAt}/> }, { key: "status", label: "Integrity", sort: d => d.verificationStatus ?? "", render: d => <StatusBadge status={d.verificationStatus}/> }]}/> : <EmptyState title="No evidence added yet" description={upload ? "Use Upload document to securely add the first record." : "The assigned contributor can add evidence to this case."}/>}</SectionCard><div className="grid gap-5 lg:grid-cols-2"><SectionCard title="Assigned team">{data.assignments.map(a => <div className="flex flex-wrap justify-between gap-2 border-b py-3 last:border-0" key={a.userName}><span className="text-sm font-medium">{a.userName}</span><span className="text-xs text-muted-foreground">{roleLabel(a.role)}</span></div>)}</SectionCard><SectionCard title="Case folder commitment">{data.manifest ? <><p className="text-sm">Manifest v{data.manifest.version} · {data.manifest.documentCount} documents</p><CopyableHash value={data.manifest.root} label="Manifest root"/><p className="mt-3 text-xs text-muted-foreground">{data.manifest.anchor?.status ?? "Not anchored"} · {data.manifest.anchor?.explorerUrl ? "Blockchain receipt" : "Local dev chain"}</p>{data.manifest.anchor && <CopyableHash value={data.manifest.anchor.txHash} label="Manifest transaction"/>}</> : <p className="text-sm text-muted-foreground">No sealed manifest yet. Assemble after evidence is verified.</p>}</SectionCard></div></div>;
}
