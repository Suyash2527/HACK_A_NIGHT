"use client";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useSession } from "./session";
import { useResource } from "./use-resource";
import { ResourceError } from "./access-state";
import { PageHeader } from "./page-header";
import { SectionCard, DataTable, PageSkeleton, RelativeTime, TechnicalDetails } from "./design-system";
import { RegisterFir } from "./register-fir";
import { FirNumber } from "./fir-number";
import { FirCheckBox } from "./fir-check";
import { StatusBadge } from "./status-badge";
import { caseStatus, needsAttention } from "./case-status";
import { useI18n } from "./i18n";
import type { MessageKey } from "./i18n/en";

type StatusFilter = "" | "ATTENTION" | "VERIFIED" | "SEALING";

const STATUS_OPTIONS: { value: StatusFilter; label: MessageKey }[] = [
  { value: "ATTENTION", label: "cases.filter.attention" },
  { value: "VERIFIED", label: "cases.filter.verified" },
  { value: "SEALING", label: "cases.filter.sealing" },
];

export function CasesView() {
  const { t, label } = useI18n();
  const session = useSession();
  const resource = useResource("GET /api/cases", { query: { limit: 100 } });
  const [stage, setStage] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  if (resource.loading) return <PageSkeleton />;
  if (resource.error || !resource.data) return <ResourceError error={resource.error || new Error(t("err.noData"))} retry={resource.reload} />;

  const all = resource.data.items;
  const attention = all.filter(needsAttention).length;
  const rows = all.filter(c => {
    if (stage && c.stage !== stage) return false;
    if (status === "ATTENTION") return needsAttention(c);
    if (status === "VERIFIED") return caseStatus(c) === "VERIFIED";
    if (status === "SEALING") return ["PENDING_ANCHOR", "UNANCHORED"].includes(caseStatus(c) ?? "");
    return true;
  });
  const role = session.user.role;
  const title = role === "POLICE" ? "cases.title.station" : role === "FORENSIC_LAB" ? "cases.title.assigned" : "cases.title.court";

  return (
    <div className="page-grid">
      <PageHeader
        title={t(title)}
        description={t("cases.sub")}
        breadcrumbs={[{ label: t("nav.home"), href: "/dashboard" }, { label: t("cases.crumb") }]}
        action={session.canCreateCase && (
          <RegisterFir onCreated={created => resource.setData(current => current
            ? { ...current, items: [created, ...current.items.filter(item => item.id !== created.id)] }
            : { items: [created], nextCursor: null })} />
        )}
      />
      <div className="no-print flex flex-wrap items-center gap-3" aria-label={t("cases.status")}>
        <FilterSelect label={t("cases.stage")} value={stage} onChange={setStage} options={Array.from(new Set(all.map(c => c.stage))).map(value => ({ value, label: label(value) }))} />
        <FilterSelect label={t("cases.status")} value={status} onChange={value => setStatus(value as StatusFilter)} options={STATUS_OPTIONS.map(o => ({ value: o.value, label: t(o.label) }))} />
        {(stage || status) && <Button variant="ghost" size="sm" onClick={() => { setStage(""); setStatus(""); }}>{t("common.clearFilters")}</Button>}
        {attention > 0 && <span className="text-base text-tampered">{t("cases.attentionLine", { n: attention })}</span>}
      </div>
      <SectionCard>
        <DataTable
          rows={rows}
          resetKey={stage + "|" + status}
          rowKey={c => c.id}
          searchText={c => c.firNo + " " + c.station}
          searchLabel={t("cases.search")}
          columns={[
            { key: "fir", label: t("col.fir"), sort: c => c.firNo, render: c => <Link href={"/cases/" + c.id} className="text-primary"><FirNumber value={c.firNo} /></Link> },
            { key: "station", label: t("col.station"), sort: c => c.station, render: c => c.station },
            { key: "stage", label: t("col.stage"), sort: c => c.stage, render: c => label(c.stage) },
            { key: "files", label: t("col.documents"), sort: c => c.documentCount, render: c => <span className="font-mono">{c.documentCount}</span> },
            { key: "status", label: t("col.status"), sort: c => caseStatus(c) ?? "UNCHECKED", render: c => <StatusBadge status={caseStatus(c)} /> },
            { key: "filed", label: t("col.filed"), sort: c => c.createdAt, render: c => <RelativeTime at={c.createdAt} /> },
          ]}
        />
      </SectionCard>
      <TechnicalDetails title={t("frc.title")}>
        <FirCheckBox />
      </TechnicalDetails>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  const { t } = useI18n();
  return (
    <label className="filter-chip flex items-center gap-2" style={value ? { borderColor: "#c2410c" } : undefined}>
      <span>{label}</span>
      <select aria-label={label} value={value} onChange={e => onChange(e.target.value)} className="max-w-56 border-0 text-base">
        <option value="">{t("common.all")}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
