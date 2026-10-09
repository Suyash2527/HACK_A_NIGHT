"use client";
import Link from "next/link";
import type { CaseSummary } from "@/types/api";
import { Button } from "@/components/ui/button";
import { useSession } from "./session";
import { useResource } from "./use-resource";
import { ResourceError } from "./access-state";
import { PageHeader } from "./page-header";
import { DataTable, InlineNotice, PageSkeleton, RelativeTime, SectionCard } from "./design-system";
import { AssignedCaseAction, JudgeRequestsAction, VerifyAuditAction } from "./home-actions";
import { ProgressTimeline } from "./progress-timeline";
import { RegisterFir } from "./register-fir";
import { FirNumber } from "./fir-number";
import { StatusBadge } from "./status-badge";
import { caseStatus, needsAttention } from "./case-status";
import { useI18n } from "./i18n";

export function DashboardView() {
  const { t, label } = useI18n();
  const session = useSession();
  const cases = useResource("GET /api/cases", { query: { limit: 100 } });
  if (cases.loading) return <PageSkeleton />;
  if (cases.error || !cases.data) return <ResourceError error={cases.error || new Error(t("err.noData"))} retry={cases.reload} />;

  const rows = cases.data.items;
  const role = session.user.role;

  if (role === "COMPLAINANT") {
    return (
      <div className="page-grid">
        <PageHeader title={t("nav.progress")} description={t("home.complainantSub")} />
        {rows.map(c => <ProgressTimeline key={c.id} caseId={c.id} />)}
        {!rows.length && <p className="text-base text-muted-foreground">{t("home.noCase")}</p>}
      </div>
    );
  }

  const attention = rows.filter(needsAttention).length;
  const kind = role === "POLICE" ? "station" : role === "ADMIN" ? "admin" : role === "JUDGE" ? "court" : "assigned";

  const columns = [
    { key: "fir", label: t("col.fir"), sort: (c: CaseSummary) => c.firNo, render: (c: CaseSummary) => <Link className="text-primary" href={"/cases/" + c.id}><FirNumber value={c.firNo} /></Link> },
    ...(role === "POLICE" ? [] : [{ key: "station", label: t("col.station"), render: (c: CaseSummary) => c.station }]),
    { key: "stage", label: t("col.stage"), render: (c: CaseSummary) => label(c.stage) },
    { key: "documents", label: t("col.documents"), sort: (c: CaseSummary) => c.documentCount, render: (c: CaseSummary) => c.documentCount },
    { key: "status", label: t("col.status"), render: (c: CaseSummary) => <StatusBadge status={caseStatus(c)} /> },
    { key: "filed", label: t("col.filed"), sort: (c: CaseSummary) => c.createdAt, render: (c: CaseSummary) => <RelativeTime at={c.createdAt} /> },
  ];

  return (
    <div className="page-grid">
      <PageHeader
        title={t(`home.title.${kind}`)}
        description={t(`home.sub.${kind}`)}
        action={
          <>
            {session.canCreateCase && <RegisterFir onCreated={() => cases.reload()} />}
            {role === "JUDGE" && <JudgeRequestsAction />}
            {role === "ADMIN" && <VerifyAuditAction />}
          </>
        }
      />
      {["FORENSIC_LAB", "PUBLIC_PROSECUTOR"].includes(role) && (
        <AssignedCaseAction cases={rows} prosecutor={role === "PUBLIC_PROSECUTOR"} onComplete={cases.reload} />
      )}
      {attention > 0 && <InlineNotice danger>{t("home.attention", { n: attention })}</InlineNotice>}
      <SectionCard
        title={t("home.casesTitle")}
        action={<Button asChild variant="link"><Link href="/cases">{t("home.moreFilters")}</Link></Button>}
      >
        <DataTable rows={rows} rowKey={c => c.id} searchText={c => c.firNo + " " + c.station} searchLabel={t("cases.search")} columns={columns} empty={t("home.noCases")} emptyHelp={t(session.canCreateCase ? "home.noCasesPolice" : "home.noCasesOther")} />
      </SectionCard>
    </div>
  );
}
