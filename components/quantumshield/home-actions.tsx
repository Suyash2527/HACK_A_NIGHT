"use client";
import { useState } from "react";
import Link from "next/link";
import type { CaseSummary, AuditChainResult } from "@/types/api";
import { api } from "@/components/api-client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { UploadDialog } from "./upload-dialog";
import { AssemblyReportDialog } from "./assembly-report";
import { useResource } from "./use-resource";
import { ResourceError } from "./access-state";
import { InlineNotice, RelativeTime } from "./design-system";

export function AssignedCaseAction({ cases, prosecutor, onComplete }: { cases: CaseSummary[]; prosecutor: boolean; onComplete: () => void }) {
  const [selected, setSelected] = useState("");
  const caseId = selected || cases[0]?.id;
  if (!caseId) return <p className="text-sm text-muted-foreground">No case assigned. Ask the investigating officer to confirm your assignment.</p>;
  return <div className="flex flex-wrap items-end gap-3 border-y py-3">
    <div className="grid min-w-0 gap-1"><Label htmlFor="home-case">Assigned case</Label><select id="home-case" value={caseId} onChange={e => setSelected(e.target.value)} className="max-w-full border bg-white px-3 py-2 font-mono text-sm">{cases.map(c => <option key={c.id} value={c.id}>{c.firNo}</option>)}</select></div>
    <UploadDialog key={caseId} caseId={caseId} allowedTypes={prosecutor ? ["CHARGE_SHEET"] : ["FORENSIC_REPORT"]} label={prosecutor ? "Upload charge sheet" : "Upload forensic report"} onComplete={onComplete}/>
    {prosecutor && <AssemblyReportDialog caseId={caseId}/>}
  </div>;
}

export function JudgeRequestsAction() {
  const requests = useResource("GET /api/requests", { query: { status: "PENDING" } });
  return <div className="flex flex-wrap items-center gap-3"><Button asChild><Link href="/requests">Decide requests</Link></Button>{requests.loading ? <span role="status">Counting pending requests…</span> : requests.error ? <ResourceError error={requests.error} retry={requests.reload}/> : <span className="text-sm">{requests.data?.items.length ?? 0} pending requests</span>}</div>;
}

export function VerifyAuditAction() {
  const [result, setResult] = useState<AuditChainResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function verify() {
    setBusy(true); setError("");
    try { setResult(await api("POST /api/audit/verify")); }
    catch (error) { setError(error instanceof Error ? error.message : "Audit chain could not be checked. Try again."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3"><Button disabled={busy} onClick={() => void verify()}>{busy ? "Checking audit chain…" : "Verify audit chain"}</Button>{error && <InlineNotice danger>{error}</InlineNotice>}{result && <InlineNotice danger={result.status === "fail"}>Audit chain: {result.status === "pass" ? "checks passed" : result.status === "fail" ? "chain mismatch" : "not checked"} · {result.checkedEntries} entries · <RelativeTime at={result.checkedAt}/></InlineNotice>}</div>;
}
