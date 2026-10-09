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
import { EmptyState, LegalBasisView, PageSkeleton, RelativeTime, SectionCard } from "./design-system";
import { FirNumber } from "./fir-number";
import { PageHeader } from "./page-header";
import { useI18n } from "./i18n";

const FILTERS = ["ALL", "PENDING", "GRANTED", "REJECTED", "EXPIRED"] as const;

export function RequestsWorkspace() {
  const { t, label, formatDate } = useI18n();
  const session = useSession();
  const judge = session.user.role === "JUDGE";
  const resource = useResource("GET /api/requests", {});
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  if (!judge && session.user.role !== "DEFENCE_ADVOCATE") return <AccessDenied />;
  if (resource.loading) return <PageSkeleton />;
  if (resource.error) return <ResourceError error={resource.error} retry={resource.reload} />;

  const update = (record: DocumentRequest) =>
    resource.setData(current => ({ items: [record, ...(current?.items ?? []).filter(r => r.id !== record.id)], nextCursor: current?.nextCursor ?? null }));
  const records = resource.data?.items.filter(r => filter === "ALL" || r.status === filter) ?? [];
  const who = judge ? "judge" : "advocate";

  return (
    <div className="page-grid">
      <PageHeader title={t(`req.title.${who}`)} description={t(`req.sub.${who}`)} action={!judge && <FileRequestDialog onComplete={update} />} />
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(s => (
          <Button key={s} variant="outline" aria-pressed={filter === s} onClick={() => setFilter(s)}>{s === "ALL" ? t("common.all") : label(s)}</Button>
        ))}
      </div>
      {records.length ? records.map((request, index) => (
        <SectionCard
          key={request.id}
          title={<><FirNumber value={request.firNo} /> · {request.requester.name}</>}
          description={t("req.docCount", { n: request.documentIds.length })}
          action={
            <span className={"status-pill " + (request.status === "REJECTED" ? "tone-danger" : request.status === "PENDING" ? "tone-pending" : request.status === "GRANTED" ? "tone-info" : "tone-neutral")}>
              {request.status === "REJECTED" ? <XCircle className="size-3" /> : request.status === "PENDING" ? <Clock className="size-3" /> : <Gavel className="size-3" />}
              {label(request.status)}
            </span>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div><p className="section-label">{t("req.basis")}</p><LegalBasisView value={request.legalBasis} /></div>
            <div><p className="section-label">{t("req.reason")}</p><p className="text-base">{request.reason}</p><RelativeTime at={request.filedAt} /></div>
          </div>
          {request.status === "GRANTED" && request.decision && (
            <div className="mt-3 flex flex-wrap gap-2">
              {request.decision.grantedDocumentIds.map((id, i) => (
                <Button key={id} asChild variant="outline"><Link href={"/documents/" + id}>{t("req.openGranted", { n: i + 1 })}</Link></Button>
              ))}
            </div>
          )}
          {request.decision && (
            <div className="mt-4 border bg-muted/40 p-3 text-base">
              <b>{request.decision.orderRef}</b>
              <p>{request.decision.note}</p>
              <p className="mt-2 text-sm text-muted-foreground">{t("req.grantedTill", { until: request.decision.expiresAt ? formatDate(request.decision.expiresAt) : t("req.noEnd") })}</p>
            </div>
          )}
          {judge && request.status === "PENDING" && <div className="mt-4"><DecisionDialog primary={index === 0} request={request} onComplete={update} /></div>}
        </SectionCard>
      )) : (
        <SectionCard><EmptyState title={t("req.empty")} description={t(judge ? "req.emptyJudge" : "req.emptyAdvocate")} /></SectionCard>
      )}
    </div>
  );
}

function FileRequestDialog({ onComplete }: { onComplete: (r: DocumentRequest) => void }) {
  const { t, label } = useI18n();
  const [open, setOpen] = useState(false);
  const [firNo, setFirNo] = useState("");
  const [catalog, setCatalog] = useState<RequestCatalog | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [basis, setBasis] = useState<FileRequestBody["legalBasis"]["code"]>("STATUTORY_DISCLOSURE");
  const [citation, setCitation] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);

  async function lookup() {
    setLookupBusy(true);
    setError("");
    setCatalog(null);
    setSelected([]);
    try {
      setCatalog(await api("GET /api/requests/catalog", { query: { firNo: firNo.trim().toUpperCase() } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("req.lookupFailed"));
    } finally {
      setLookupBusy(false);
    }
  }

  async function submit() {
    if (!catalog || !selected.length || !citation.trim() || !reason.trim()) {
      setError(t("req.needAll"));
      return;
    }
    setBusy(true);
    setError("");
    const body: FileRequestBody = { caseId: catalog.caseId, documentIds: selected, legalBasis: { code: basis, citation: citation.trim() }, reason: reason.trim() };
    try {
      onComplete(await api("POST /api/requests", { body }));
      setOpen(false);
      toast.success(t("req.sent"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("req.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Send />{t("req.request")}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("req.request")}</DialogTitle>
          <DialogDescription>{t("req.fileDesc")}</DialogDescription>
        </DialogHeader>
        <Label htmlFor="request-fir">{t("req.firNo")}</Label>
        <div className="flex gap-2">
          <Input id="request-fir" value={firNo} className="font-mono" placeholder="STATION/YEAR/SERIAL/CODE" onChange={e => { setFirNo(e.target.value); setCatalog(null); setSelected([]); }} />
          <Button variant="outline" disabled={lookupBusy || !firNo.trim()} onClick={() => void lookup()}>{lookupBusy ? t("req.finding") : t("req.find")}</Button>
        </div>
        {catalog && (
          <>
            <p className="text-sm text-muted-foreground">{catalog.station} · {label(catalog.stage)}</p>
            <fieldset className="space-y-2">
              <legend className="mb-2 text-base font-medium">{t("req.docs")}</legend>
              {catalog.documents.map(d => (
                <label key={d.id} className="flex items-center gap-2 border p-2 text-base">
                  <input type="checkbox" checked={selected.includes(d.id)} onChange={e => setSelected(s => e.target.checked ? [...s, d.id] : s.filter(i => i !== d.id))} />
                  {d.filename} · {t("case.version", { v: d.version })}
                </label>
              ))}
              {!catalog.documents.length && <p className="text-sm text-muted-foreground">{t("req.noDocs")}</p>}
            </fieldset>
          </>
        )}
        <Label htmlFor="request-basis">{t("req.basisField")}</Label>
        <select id="request-basis" className="border p-2 text-base" value={basis} onChange={e => setBasis(e.target.value as FileRequestBody["legalBasis"]["code"])}>
          <option value="STATUTORY_DISCLOSURE">{label("STATUTORY_DISCLOSURE")}</option>
          <option value="COURT_ORDER">{label("COURT_ORDER")}</option>
        </select>
        <Label htmlFor="request-citation">{t("req.citation")}</Label>
        <Input id="request-citation" value={citation} onChange={e => setCitation(e.target.value)} />
        <Label htmlFor="request-reason">{t("req.reasonField")}</Label>
        <Textarea id="request-reason" value={reason} onChange={e => setReason(e.target.value)} />
        {error && <p className="text-base text-tampered" role="alert">{error}</p>}
        <DialogFooter showCloseButton>
          <Button disabled={busy || !catalog || !selected.length} onClick={() => void submit()}>{busy ? t("req.submitting") : t("req.submit")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DecisionDialog({ request, onComplete, primary }: { primary: boolean; request: DocumentRequest; onComplete: (r: DocumentRequest) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<DecideRequestBody["decision"]>("GRANT");
  const [order, setOrder] = useState("");
  const [note, setNote] = useState("");
  const [expiry, setExpiry] = useState("");
  const [subset, setSubset] = useState(request.documentIds);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const documents = useResource("GET /api/documents", { query: { caseId: request.caseId } });

  async function submit() {
    if (!order.trim() || !note.trim() || (decision === "GRANT" && !subset.length)) {
      setError(t("dec.needAll"));
      return;
    }
    if (expiry && new Date(expiry).getTime() <= Date.now()) {
      setError(t("dec.future"));
      return;
    }
    setBusy(true);
    setError("");
    const body: DecideRequestBody = {
      decision,
      orderRef: order.trim(),
      note: note.trim(),
      grantedDocumentIds: decision === "GRANT" ? subset : [],
      expiresAt: expiry ? new Date(expiry).toISOString() : null,
    };
    try {
      onComplete(await api("POST /api/requests/[id]/decision", { params: { id: request.id }, body }));
      setOpen(false);
      toast.success(t("dec.recorded"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("dec.failed"));
      toast.error(t("dec.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant={primary ? "default" : "outline"}><Gavel />{t("req.review")}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dec.title")}</DialogTitle>
          <DialogDescription>{t("dec.desc", { name: request.requester.name, fir: request.firNo })}</DialogDescription>
        </DialogHeader>
        <LegalBasisView value={request.legalBasis} />
        <p className="text-base">{request.reason}</p>
        <Label htmlFor="decision">{t("dec.decision")}</Label>
        <select className="h-11 border bg-background px-3 text-base" id="decision" value={decision} onChange={e => setDecision(e.target.value as DecideRequestBody["decision"])}>
          <option value="GRANT">{t("dec.grant")}</option>
          <option value="REJECT">{t("dec.reject")}</option>
        </select>
        {decision === "GRANT" && (
          <fieldset className="space-y-2">
            <legend>{t("dec.docs")}</legend>
            {request.documentIds.map((id, index) => (
              <label key={id} className="flex items-center gap-2 border p-3 text-base">
                <input type="checkbox" checked={subset.includes(id)} onChange={e => setSubset(s => e.target.checked ? [...s, id] : s.filter(i => i !== id))} />
                {documents.data?.items.find(d => d.id === id)?.filename ?? t("dec.docFallback", { n: index + 1 })}
              </label>
            ))}
          </fieldset>
        )}
        <Label htmlFor="decision-order">{t("dec.order")}</Label>
        <Input id="decision-order" value={order} onChange={e => setOrder(e.target.value)} />
        <Label htmlFor="decision-note">{t("dec.note")}</Label>
        <Textarea id="decision-note" value={note} onChange={e => setNote(e.target.value)} />
        {decision === "GRANT" && (
          <>
            <Label htmlFor="decision-expiry">{t("dec.expiry")}</Label>
            <Input id="decision-expiry" type="datetime-local" value={expiry} onChange={e => setExpiry(e.target.value)} />
          </>
        )}
        {error && <p role="alert" className="text-base text-tampered">{error}</p>}
        <DialogFooter showCloseButton>
          <Button variant={decision === "REJECT" ? "destructive" : "default"} disabled={busy} onClick={() => void submit()}>
            {busy ? t("dec.recording") : t(decision === "GRANT" ? "dec.confirmGrant" : "dec.confirmReject")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
