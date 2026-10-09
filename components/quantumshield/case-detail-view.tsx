"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useSession } from "./session";
import { useResource } from "./use-resource";
import { ResourceError } from "./access-state";
import { CopyableHash, DataTable, EmptyState, FileIcon, PageSkeleton, PrintButton, RelativeTime, SectionCard, TechnicalDetails } from "./design-system";
import { PageHeader } from "./page-header";
import { FirNumber } from "./fir-number";
import { StatusBadge } from "./status-badge";
import { UploadDialog } from "./upload-dialog";
import { AssemblyReportDialog } from "./assembly-report";
import { useI18n } from "./i18n";

export function CaseDetailView({ id }: { id: string }) {
  const { t, label } = useI18n();
  const session = useSession();
  const record = useResource("GET /api/cases/[id]", { params: { id } });
  const documents = useResource("GET /api/documents", { query: { caseId: id } });
  if (record.loading || documents.loading) return <PageSkeleton />;
  if (record.error || documents.error) {
    return <ResourceError error={record.error || documents.error!} retry={() => { record.reload(); documents.reload(); }} />;
  }
  const data = record.data;
  if (!data) return <EmptyState title={t("case.unavailable")} description={t("case.unavailableHelp")} />;

  const canUpload = data.canUpload && session.allowedUploadTypes.length > 0;
  const folder = <AssemblyReportDialog caseId={id} disabled={!data.canAssemble} />;

  return (
    <div className="page-grid">
      <PageHeader
        title={<FirNumber value={data.firNo} />}
        description={data.station + " · " + label(data.stage)}
        breadcrumbs={[{ label: t("cases.crumb"), href: "/cases" }, { label: <FirNumber value={data.firNo} /> }]}
        action={canUpload ? <UploadDialog caseId={id} allowedTypes={data.allowedUploadTypes} onComplete={documents.reload} /> : folder}
      />
      <div className="no-print flex flex-wrap gap-2">
        {canUpload && folder}
        <Button variant="outline" asChild><Link href={"/cases/" + id + "/progress"}>{t("case.progress")}</Link></Button>
        <PrintButton label={t("doc.print")} />
      </div>
      <SectionCard title={t("case.docs")} description={t("case.docsHelp")}>
        {documents.data?.items.length ? (
          <DataTable
            rows={documents.data.items}
            rowKey={d => d.id}
            searchText={d => d.filename + " " + d.type}
            searchLabel={t("case.findDoc")}
            columns={[
              {
                key: "name",
                label: t("col.document"),
                sort: d => d.filename,
                render: d => (
                  <div className="flex items-center gap-3">
                    <FileIcon mime={d.mimeType} />
                    <div>
                      <Link className="font-medium text-primary hover:underline" href={"/documents/" + d.id}>{d.filename}</Link>
                      <p className="text-sm text-muted-foreground">{label(d.type)} · {t("case.version", { v: d.version })}</p>
                    </div>
                  </div>
                ),
              },
              { key: "filed", label: t("col.filed"), sort: d => d.createdAt, render: d => <RelativeTime at={d.createdAt} /> },
              { key: "status", label: t("col.status"), sort: d => d.verificationStatus ?? "", render: d => <StatusBadge status={d.verificationStatus} /> },
            ]}
          />
        ) : (
          <EmptyState title={t("case.noDocs")} description={t(canUpload ? "case.noDocsUpload" : "case.noDocsOther")} />
        )}
      </SectionCard>
      <SectionCard title={t("case.team")}>
        {data.assignments.map(a => (
          <div className="flex flex-wrap justify-between gap-2 border-b py-3 last:border-0" key={a.userName}>
            <span className="text-base font-medium">{a.userName}</span>
            <span className="text-sm text-muted-foreground">{label(a.role)}</span>
          </div>
        ))}
      </SectionCard>
      <TechnicalDetails title={t("case.seal")}>
        {data.manifest ? (
          <>
            <p className="text-base">{t("case.sealVersion", { v: data.manifest.version, n: data.manifest.documentCount })}</p>
            <div><p className="section-label">{t("case.sealRoot")}</p><CopyableHash value={data.manifest.root} /></div>
            {data.manifest.anchor && <div><p className="section-label">{t("case.sealTx")}</p><CopyableHash value={data.manifest.anchor.txHash} /></div>}
            <p className="text-sm text-muted-foreground">
              {t(!data.manifest.anchor ? "case.sealNone" : data.manifest.anchor.explorerUrl ? "case.sealChain" : "case.sealLocal")}
            </p>
          </>
        ) : (
          <p className="text-base text-muted-foreground">{t("case.noSeal")}</p>
        )}
      </TechnicalDetails>
    </div>
  );
}
