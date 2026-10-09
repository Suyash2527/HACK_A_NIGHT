"use client";
import Link from "next/link";
import { useState } from "react";
import { Clock, Gavel, Send, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { DecideRequestBody, DocumentRequest, FileRequestBody, RequestCatalog } from "@/types/api";
import { api } from "@/components/api-client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "./session";
import { useResource } from "./use-resource";
import { AccessDenied, ResourceError } from "./access-state";
import { EmptyState, LegalBasisView, PageSkeleton, RelativeTime, SectionCard, humanize } from "./design-system";
import { FirNumber } from "./fir-number";
import { PageHeader } from "./page-header";
import { formatIST } from "./format";
export function RequestsWorkspace() {
    const session = useSession();
    const judge = session.user.role === "JUDGE";
    const resource = useResource("GET /api/requests", {});
    const [filter, setFilter] = useState("ALL");
    if (!judge && session.user.role !== "DEFENCE_ADVOCATE")
        return <AccessDenied />;
    if (resource.loading)
        return <PageSkeleton />;
    if (resource.error)
        return <ResourceError error={resource.error} retry={resource.reload}/>;
    const update = (record: DocumentRequest) => resource.setData(current => ({ items: [record, ...(current?.items ?? []).filter(r => r.id !== record.id)], nextCursor: current?.nextCursor ?? null }));
    const records = resource.data?.items.filter(r => filter === "ALL" || r.status === filter) ?? [];
    return <div className="page-grid"><PageHeader eyebrow="Court-controlled disclosure" title={judge ? "Access review queue" : "Document requests"} description={judge ? "Review the legal basis, choose the permitted evidence and record the court order." : "Ask the court for specific evidence. Filing does not grant access."} action={!judge && <FileRequestDialog onComplete={update}/>}/><div className="flex flex-wrap gap-2">{["ALL", "PENDING", "GRANTED", "REJECTED", "EXPIRED"].map(s => <Button key={s} variant={filter === s ? "default" : "outline"} aria-pressed={filter === s} onClick={() => setFilter(s)}>{humanize(s)}</Button>)}</div>{records.length ? records.map(request => <SectionCard key={request.id} title={<><FirNumber value={request.firNo}/> · {request.requester.name}</>} description={request.documentIds.length + " documents requested"} action={<span className={"status-pill " + (request.status === "REJECTED" ? "tone-danger" : request.status === "PENDING" ? "tone-pending" : request.status === "GRANTED" ? "tone-info" : "tone-neutral")}>{request.status === "REJECTED" ? <XCircle className="size-3"/> : request.status === "PENDING" ? <Clock className="size-3"/> : <Gavel className="size-3"/>}{humanize(request.status)}</span>}><div className="grid gap-4 sm:grid-cols-2"><div><p className="section-label">Legal basis</p><LegalBasisView value={request.legalBasis}/></div><div><p className="section-label">Reason</p><p className="text-sm">{request.reason}</p><RelativeTime at={request.filedAt}/></div></div>{request.status === "GRANTED" && request.decision && <div className="mt-3 flex flex-wrap gap-2">{request.decision.grantedDocumentIds.map((id, i) => <Button key={id} asChild variant="outline"><Link href={"/documents/" + id}>Open granted document {i + 1}</Link></Button>)}</div>}{request.decision && <div className="mt-4 rounded-lg border bg-muted/40 p-3 text-sm"><b>{request.decision.orderRef}</b><p>{request.decision.note}</p><p className="mt-2 text-xs text-muted-foreground">Granted till: {request.decision.expiresAt ? formatIST(request.decision.expiresAt) : "No scheduled expiry"}</p></div>}{judge && request.status === "PENDING" && <div className="mt-4"><DecisionDialog request={request} onComplete={update}/></div>}</SectionCard>) : <SectionCard><EmptyState title="No requests in this view" description={judge ? "New advocate requests appear here for review." : "File a request with the documents and legal citation you need."}/></SectionCard>}</div>;
}
function FileRequestDialog({ onComplete }: {
    onComplete: (r: DocumentRequest) => void;
}) {

    const [open, setOpen] = useState(false), [selected, setSelected] = useState<string[]>([]), [citation, setCitation] = useState(""), [reason, setReason] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [lookupBusy, setLookupBusy] = useState(false), [firNo, setFirNo] = useState(""), [catalog, setCatalog] = useState<RequestCatalog | null>(null), [basis, setBasis] = useState<FileRequestBody["legalBasis"]["code"]>("STATUTORY_DISCLOSURE");
    async function lookup() {
        setLookupBusy(true);
        setError("");
        setCatalog(null);
        setSelected([]);
        try {
            setCatalog(await api("GET /api/requests/catalog", { query: { firNo: firNo.trim().toUpperCase() } }));
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "Case lookup failed");
        }
        finally {
            setLookupBusy(false);
        }
    }
    async function submit() {
        if (!catalog || !selected.length || !citation.trim() || !reason.trim()) {
            setError("Select documents and enter a citation and reason.");
            return;
        }
        setBusy(true);
        setError("");
        const body: FileRequestBody = { caseId: catalog.caseId, documentIds: selected, legalBasis: { code: basis, citation: citation.trim() }, reason: reason.trim() };
        try {
            onComplete(await api("POST /api/requests", { body }));
            setOpen(false);
            toast.success("Request filed");
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "Request failed");
        }
        finally {
            setBusy(false);
        }
    }
    return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button><Send />File request</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Request documents</DialogTitle><DialogDescription>Enter the FIR No. to retrieve document titles. Citations are recorded verbatim.</DialogDescription></DialogHeader><Label htmlFor="request-fir">FIR No.</Label><div className="flex gap-2"><Input id="request-fir" value={firNo} className="font-mono" placeholder="STATION/YEAR/SERIAL/CODE" onChange={e => { setFirNo(e.target.value); setCatalog(null); setSelected([]); }}/><Button variant="outline" disabled={lookupBusy || !firNo.trim()} onClick={() => void lookup()}>{lookupBusy ? "Finding…" : "Find case"}</Button></div>{catalog && <><p className="text-xs text-muted-foreground">{catalog.station} · {humanize(catalog.stage)}</p><fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Documents</legend>{catalog.documents.map(d => <label key={d.id} className="flex items-center gap-2 border p-2 text-sm"><input type="checkbox" checked={selected.includes(d.id)} onChange={e => setSelected(s => e.target.checked ? [...s, d.id] : s.filter(i => i !== d.id))}/>{d.filename} · v{d.version}</label>)}{!catalog.documents.length && <p className="text-xs text-muted-foreground">No documents recorded</p>}</fieldset></>}<Label htmlFor="request-basis">Legal basis</Label><select id="request-basis" className="border p-2" value={basis} onChange={e => setBasis(e.target.value as FileRequestBody["legalBasis"]["code"])}><option value="STATUTORY_DISCLOSURE">Statutory disclosure</option><option value="COURT_ORDER">Court order</option></select><Label htmlFor="request-citation">Citation / order reference</Label><Input id="request-citation" value={citation} onChange={e => setCitation(e.target.value)}/><Label htmlFor="request-reason">Reason</Label><Textarea id="request-reason" value={reason} onChange={e => setReason(e.target.value)}/>{error && <p className="text-sm text-tampered" role="alert">{error}</p>}<DialogFooter showCloseButton><Button disabled={busy || !catalog || !selected.length} onClick={() => void submit()}>{busy ? "Submitting…" : "File request"}</Button></DialogFooter></DialogContent></Dialog>;
}
function DecisionDialog({ request, onComplete }: {
    request: DocumentRequest;
    onComplete: (r: DocumentRequest) => void;
}) {

    const [open, setOpen] = useState(false), [decision, setDecision] = useState<DecideRequestBody["decision"]>("GRANT"), [order, setOrder] = useState(""), [note, setNote] = useState(""), [expiry, setExpiry] = useState(""), [subset, setSubset] = useState(request.documentIds), [error, setError] = useState(""), [busy, setBusy] = useState(false);
    const documents = useResource("GET /api/documents", { query: { caseId: request.caseId } });
    async function submit() {
        if (!order.trim() || !note.trim() || (decision === "GRANT" && !subset.length)) {
            setError("An order reference, decision note and a non-empty granted subset are required.");
            return;
        }
        if (expiry && new Date(expiry).getTime() <= Date.now()) {
            setError("Choose an expiry in the future.");
            return;
        }
        setBusy(true);
        setError("");
        const body: DecideRequestBody = { decision, orderRef: order.trim(), note: note.trim(), grantedDocumentIds: decision === "GRANT" ? subset : [], expiresAt: expiry ? new Date(expiry).toISOString() : null };
        try {
            onComplete(await api("POST /api/requests/[id]/decision", { params: { id: request.id }, body }));
            setOpen(false);
            toast.success("Court decision recorded");
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "Decision failed");
            toast.error("Could not record decision");
        }
        finally {
            setBusy(false);
        }
    }
    return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button><Gavel />Review request</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Review and confirm court decision</DialogTitle><DialogDescription>{request.requester.name} · <FirNumber value={request.firNo}/>. The decision is append-only and audited.</DialogDescription></DialogHeader><LegalBasisView value={request.legalBasis}/><p className="text-sm">{request.reason}</p><Label htmlFor="decision">Decision</Label><select className="h-11 rounded-md border bg-background px-3" id="decision" value={decision} onChange={e => setDecision(e.target.value as DecideRequestBody["decision"])}><option value="GRANT">Grant selected documents</option><option value="REJECT">Reject request</option></select>{decision === "GRANT" && <fieldset className="space-y-2"><legend>Documents to grant</legend>{request.documentIds.map((id, index) => <label key={id} className="flex items-center gap-2 rounded border p-3"><input type="checkbox" checked={subset.includes(id)} onChange={e => setSubset(s => e.target.checked ? [...s, id] : s.filter(i => i !== id))}/>{documents.data?.items.find(d => d.id === id)?.filename ?? "Requested document " + (index + 1)}</label>)}</fieldset>}<Label htmlFor="decision-order">Order ref. (required)</Label><Input id="decision-order" value={order} onChange={e => setOrder(e.target.value)}/><Label htmlFor="decision-note">Decision note (required)</Label><Textarea id="decision-note" value={note} onChange={e => setNote(e.target.value)}/>{decision === "GRANT" && <><Label htmlFor="decision-expiry">Expiry (optional, your local time)</Label><Input id="decision-expiry" type="datetime-local" value={expiry} onChange={e => setExpiry(e.target.value)}/></>}{error && <p role="alert" className="text-sm text-tampered">{error}</p>}<DialogFooter showCloseButton><Button variant={decision === "REJECT" ? "destructive" : "default"} disabled={busy} onClick={() => void submit()}>{busy ? "Recording…" : decision === "GRANT" ? "Confirm grant" : "Confirm rejection"}</Button></DialogFooter></DialogContent></Dialog>;
}
