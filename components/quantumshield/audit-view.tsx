"use client";
import { useState } from "react";
import { Link2, ShieldAlert, Activity } from "lucide-react";
import { toast } from "sonner";
import { AUDIT_ACTIONS, type AuditAction, type AuditChainResult, type FirRegisterResult } from "@/types/api";
import { api } from "@/components/api-client";
import { Button } from "@/components/ui/button";
import { useResource } from "./use-resource";
import { ResourceError } from "./access-state";
import { CopyableHash, DataTable, InlineNotice, LegalBasisView, PageSkeleton, RelativeTime, SectionCard } from "./design-system";
import { useSession } from "./session";
import { PageHeader } from "./page-header";
import { useI18n } from "./i18n";

const ALERTING = ["DENIED", "TAMPER_DETECTED"];

export function AuditView() {
  const { t, label } = useI18n();
  const session = useSession();
  const canVerifyRegister = ["JUDGE", "ADMIN"].includes(session.user.role);
  const [filter, setFilter] = useState<AuditAction | "ALL">("ALL");
  const [chain, setChain] = useState<AuditChainResult | null>(null);
  const [chainBusy, setChainBusy] = useState(false);
  const [chainError, setChainError] = useState("");
  const [register, setRegister] = useState<FirRegisterResult | null>(null);
  const [registerBusy, setRegisterBusy] = useState(false);
  const [registerError, setRegisterError] = useState("");
  const resource = useResource("GET /api/audit", { query: { action: filter === "ALL" ? undefined : filter } });

  async function verifyChain() {
    setChainBusy(true);
    setChainError("");
    try {
      setChain(await api("POST /api/audit/verify", {}));
      toast.info(t("aud.toastChain"));
    } catch (e) {
      setChainError(e instanceof Error ? e.message : t("aud.chainFailed"));
    } finally {
      setChainBusy(false);
    }
  }

  async function verifyRegister() {
    setRegisterBusy(true);
    setRegister(null);
    setRegisterError("");
    try {
      setRegister(await api("POST /api/fir/verify-register", {}));
      toast.info(t("aud.toastFir"));
    } catch (e) {
      setRegisterError(e instanceof Error ? e.message : t("aud.firFailed"));
    } finally {
      setRegisterBusy(false);
    }
  }

  const outcome = (status: "pass" | "fail" | "skip", ok: "aud.chainOk" | "aud.firOk", bad: "aud.chainBad" | "aud.firBad", none: "aud.chainNone" | "aud.firNone") =>
    t(status === "pass" ? ok : status === "fail" ? bad : none);

  return (
    <div className="page-grid">
      <PageHeader
        title={t("aud.title")}
        description={t("aud.sub")}
        action={
          <>
            <Button disabled={chainBusy} onClick={() => void verifyChain()}><Link2 />{chainBusy ? t("aud.verifying") : t("aud.verify")}</Button>
            {canVerifyRegister && <Button variant="outline" disabled={registerBusy} onClick={() => void verifyRegister()}><Link2 />{registerBusy ? t("aud.verifyFirBusy") : t("aud.verifyFir")}</Button>}
          </>
        }
      />
      {registerError && <InlineNotice danger>{registerError}</InlineNotice>}
      {register && (
        <InlineNotice danger={register.status === "fail"}>
          <b>{outcome(register.status, "aud.firOk", "aud.firBad", "aud.firNone")}</b>
          <p>{t("aud.entries", { n: register.checkedEntries })} · <RelativeTime at={register.checkedAt} /></p>
          {register.firstBrokenSeq !== null && <p>{t("aud.firstBroken", { n: register.firstBrokenSeq })}</p>}
          {register.problem && <p>{register.problem}</p>}
          <p className="mt-1">{t("aud.firNote")}</p>
        </InlineNotice>
      )}
      {chainError && <InlineNotice danger>{chainError}</InlineNotice>}
      {chain && (
        <InlineNotice danger={chain.status === "fail"}>
          <b>{outcome(chain.status, "aud.chainOk", "aud.chainBad", "aud.chainNone")}</b>
          <p>{t("aud.entries", { n: chain.checkedEntries })} · {t(chain.headAnchored ? "aud.headSealed" : "aud.headOpen")} · <RelativeTime at={chain.checkedAt} /></p>
          <div className="mt-1"><p className="section-label">{t("aud.headHash")}</p><CopyableHash value={chain.headHash} /></div>
        </InlineNotice>
      )}
      <div className="max-w-sm">
        <label htmlFor="audit-filter" className="section-label">{t("aud.filter")}</label>
        <select id="audit-filter" value={filter} onChange={e => setFilter(e.target.value as AuditAction | "ALL")} className="mt-2 h-11 w-full border bg-card px-3 text-base">
          <option value="ALL">{t("aud.all")}</option>
          {AUDIT_ACTIONS.map(a => <option key={a} value={a}>{label(a)}</option>)}
        </select>
      </div>
      {resource.loading ? <PageSkeleton /> : resource.error ? <ResourceError error={resource.error} retry={resource.reload} /> : (
        <SectionCard title={t("aud.events")} description={t("aud.eventsHelp")}>
          <DataTable
            rows={resource.data?.items ?? []}
            rowKey={e => e.id}
            searchText={e => e.actorName + " " + label(e.action) + " " + e.legalBasis.citation + " " + e.legalBasis.orderRef}
            searchLabel={t("aud.find")}
            columns={[
              { key: "at", label: t("col.time"), sort: e => e.at, render: e => <RelativeTime at={e.at} /> },
              { key: "who", label: t("col.who"), sort: e => e.actorName, render: e => <div>{e.actorName}<p className="text-sm text-muted-foreground">{label(e.role)}</p></div> },
              {
                key: "what",
                label: t("col.what"),
                sort: e => e.action,
                render: e => (
                  <div>
                    <span className={"status-pill " + (ALERTING.includes(e.action) ? "tone-danger" : "tone-neutral")}>
                      {ALERTING.includes(e.action) ? <ShieldAlert className="size-3" /> : <Activity className="size-3" />}{label(e.action)}
                    </span>
                    {e.detail && <p className="mt-2 max-w-xs whitespace-normal text-sm text-muted-foreground">{e.detail}</p>}
                  </div>
                ),
              },
              { key: "basis", label: t("col.basis"), render: e => <LegalBasisView value={e.legalBasis} /> },
              {
                key: "hash",
                label: t("col.proof"),
                render: e => (
                  <details>
                    <summary className="cursor-pointer text-primary">{t("aud.showHashes")}</summary>
                    <p className="section-label mt-2">{t("aud.entryHash")}</p>
                    <CopyableHash value={e.entryHash} />
                    <p className="section-label">{t("aud.prevHash")}</p>
                    <CopyableHash value={e.prevHash} />
                  </details>
                ),
              },
            ]}
          />
        </SectionCard>
      )}
    </div>
  );
}
