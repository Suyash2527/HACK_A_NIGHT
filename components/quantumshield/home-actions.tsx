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
import { useI18n } from "./i18n";

/** Forensic lab and prosecutor home: pick one assigned case, then add the one document type the role may add. */
export function AssignedCaseAction({ cases, prosecutor, onComplete }: { cases: CaseSummary[]; prosecutor: boolean; onComplete: () => void }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState("");
  const caseId = selected || cases[0]?.id;
  if (!caseId) return <p className="text-base text-muted-foreground">{t("home.noAssignment")}</p>;
  return (
    <div className="flex flex-wrap items-end gap-3 border-y py-4">
      <div className="grid min-w-0 gap-1">
        <Label htmlFor="home-case">{t("home.assignedCase")}</Label>
        <select id="home-case" value={caseId} onChange={e => setSelected(e.target.value)} className="max-w-full border bg-white px-3 py-2 font-mono text-base">
          {cases.map(c => <option key={c.id} value={c.id}>{c.firNo}</option>)}
        </select>
      </div>
      <UploadDialog
        key={caseId}
        caseId={caseId}
        allowedTypes={prosecutor ? ["CHARGE_SHEET"] : ["FORENSIC_REPORT"]}
        label={t(prosecutor ? "up.charge" : "up.forensic")}
        onComplete={onComplete}
      />
      {prosecutor && <AssemblyReportDialog caseId={caseId} />}
    </div>
  );
}

export function JudgeRequestsAction() {
  const { t } = useI18n();
  const requests = useResource("GET /api/requests", { query: { status: "PENDING" } });
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button asChild><Link href="/requests">{t("home.decide")}</Link></Button>
      {requests.loading ? (
        <span role="status">{t("home.counting")}</span>
      ) : requests.error ? (
        <ResourceError error={requests.error} retry={requests.reload} />
      ) : (
        <span className="text-base">{t("home.pending", { n: requests.data?.items.length ?? 0 })}</span>
      )}
    </div>
  );
}

export function VerifyAuditAction() {
  const { t } = useI18n();
  const [result, setResult] = useState<AuditChainResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function verify() {
    setBusy(true);
    setError("");
    try {
      setResult(await api("POST /api/audit/verify"));
    } catch {
      setError(t("home.auditFailed"));
    } finally {
      setBusy(false);
    }
  }

  const outcome = result && (result.status === "pass" ? "home.auditOk" : result.status === "fail" ? "home.auditBad" : "home.auditNone");
  return (
    <div className="space-y-3">
      <Button disabled={busy} onClick={() => void verify()}>{busy ? t("home.auditChecking") : t("home.auditCheck")}</Button>
      {error && <InlineNotice danger>{error}</InlineNotice>}
      {result && outcome && (
        <InlineNotice danger={result.status === "fail"}>
          {t(outcome)} · {t("home.auditEntries", { n: result.checkedEntries })} · <RelativeTime at={result.checkedAt} />
        </InlineNotice>
      )}
    </div>
  );
}
