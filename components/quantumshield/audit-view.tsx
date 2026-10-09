"use client";
import { useState } from "react";
import { Link2, ShieldAlert, Activity } from "lucide-react";
import { toast } from "sonner";
import { AUDIT_ACTIONS, type AuditAction, type AuditChainResult, type FirRegisterResult } from "@/types/api";
import { api } from "@/components/api-client";
import { Button } from "@/components/ui/button";
import { useResource } from "./use-resource";
import { ResourceError } from "./access-state";
import { CopyableHash, DataTable, InlineNotice, LegalBasisView, PageSkeleton, RelativeTime, SectionCard, humanize } from "./design-system";
import { useSession } from "./session";
import { PageHeader } from "./page-header";
export function AuditView() {
    const session = useSession();
    const canVerifyRegister = ["JUDGE", "ADMIN"].includes(session.user.role);
    const [register, setRegister] = useState<FirRegisterResult | null>(null), [registerBusy, setRegisterBusy] = useState(false), [registerError, setRegisterError] = useState("");
    async function verifyRegister() {
        if (!canVerifyRegister)
            return;
        setRegisterBusy(true);
        setRegister(null);
        setRegisterError("");
        try {
            setRegister(await api("POST /api/fir/verify-register", {}));
            toast.info("FIR register check complete");
        }
        catch (e) {
            setRegisterError(e instanceof Error ? e.message : "Could not verify FIR register");
            toast.error("FIR register check failed");
        }
        finally {
            setRegisterBusy(false);
        }
    }
    const [filter, setFilter] = useState<AuditAction | "ALL">("ALL"), [result, setResult] = useState<AuditChainResult | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
    const resource = useResource("GET /api/audit", { query: { action: filter === "ALL" ? undefined : filter } });
    async function verify() {
        setBusy(true);
        setError("");
        try {
            setResult(await api("POST /api/audit/verify", {}));
            toast.info("Audit chain check complete");
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "Could not verify audit chain");
            toast.error("Audit check failed");
        }
        finally {
            setBusy(false);
        }
    }
    return <div className="page-grid"><PageHeader eyebrow="Accountability" title="Audit trail" description="Trace each action to its actor, time and recorded legal authority." action={<><Button disabled={busy} onClick={() => void verify()}><Link2 />{busy ? "Checking…" : "Verify audit chain"}</Button>{canVerifyRegister && <Button variant="outline" disabled={registerBusy} onClick={() => void verifyRegister()}><Link2 />{registerBusy ? "Checking register…" : "Verify FIR register"}</Button>}</>}/>{registerError && <InlineNotice danger>{registerError}</InlineNotice>}{register && <InlineNotice danger={register.status === "fail"}><b>FIR register: {register.status === "pass" ? "checks passed" : register.status === "fail" ? "integrity mismatch" : "not checked"}</b><p>{register.checkedEntries} entries checked · <RelativeTime at={register.checkedAt}/></p>{register.firstBrokenSeq !== null && <p>First broken sequence: #{register.firstBrokenSeq}</p>}{register.problem && <p>{register.problem}</p>}<p className="mt-1">This checks register sequences, links and assigned numbers—not document evidence.</p></InlineNotice>}{error && <InlineNotice danger>{error}</InlineNotice>}{result && <InlineNotice danger={result.status === "fail"}><b>Audit chain: {result.status === "pass" ? "checks passed" : result.status === "fail" ? "chain mismatch" : "not checked"}</b><p>{result.checkedEntries} entries · {result.headAnchored ? "Head anchored" : "Head not anchored"} · <RelativeTime at={result.checkedAt}/></p><CopyableHash value={result.headHash} label="Audit head hash"/></InlineNotice>}<div className="max-w-sm"><label htmlFor="audit-filter" className="section-label">Filter by action</label><select id="audit-filter" value={filter} onChange={e => setFilter(e.target.value as AuditAction | "ALL")} className="mt-2 h-11 w-full rounded-lg border bg-card px-3"><option value="ALL">All actions</option>{AUDIT_ACTIONS.map(a => <option key={a} value={a}>{humanize(a)}</option>)}</select></div>{resource.loading ? <PageSkeleton /> : resource.error ? <ResourceError error={resource.error} retry={resource.reload}/> : <SectionCard title="Recorded events" description="Citations are recorded verbatim, not interpreted as legal advice."><DataTable rows={resource.data?.items ?? []} rowKey={e => e.id} searchText={e => e.actorName + " " + e.action + " " + e.legalBasis.citation + " " + e.legalBasis.orderRef} searchLabel="Find actor, action or order" columns={[{ key: "seq", label: "Event", sort: e => e.seq, render: e => <span className="text-xs text-muted-foreground">#{e.seq}</span> }, { key: "action", label: "Action", sort: e => e.action, render: e => <div><span className={"status-pill " + (["DENIED", "TAMPER_DETECTED"].includes(e.action) ? "tone-danger" : "tone-neutral")}>{["DENIED", "TAMPER_DETECTED"].includes(e.action) ? <ShieldAlert className="size-3"/> : <Activity className="size-3"/>}{humanize(e.action)}</span>{e.detail && <p className="mt-2 max-w-xs whitespace-normal text-xs text-muted-foreground">{e.detail}</p>}</div> }, { key: "actor", label: "Actor", sort: e => e.actorName, render: e => <div>{e.actorName}<p className="text-xs text-muted-foreground">{humanize(e.role)}</p></div> }, { key: "basis", label: "Legal authority", render: e => <LegalBasisView value={e.legalBasis}/> }, { key: "at", label: "Time", sort: e => e.at, render: e => <RelativeTime at={e.at}/> }, { key: "hash", label: "Proof", render: e => <details><summary className="cursor-pointer text-primary">Entry hashes</summary><p className="section-label mt-2">Entry</p><CopyableHash value={e.entryHash}/><p className="section-label">Previous</p><CopyableHash value={e.prevHash}/></details> }]}/></SectionCard>}</div>;
}
