"use client";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { VerifyResult, UploadReceipt } from "@/types/api";
import { api, ApiClientError } from "@/components/api-client";
import { Button } from "@/components/ui/button";
import { useResource } from "./use-resource";
import { useSession } from "./session";
import { ResourceError } from "./access-state";
import { CopyableHash, ExplainTerm, EmptyState, InlineNotice, LegalBasisView, PageSkeleton, PrintButton, RelativeTime, SectionCard, Timeline, TimelineItem } from "./design-system";
import { IntegrityPanel } from "./integrity-panel";
import { BlockchainActivity } from "./blockchain-activity";
import { PageHeader } from "./page-header";
import { UploadDialog } from "./upload-dialog";
import { StatusBadge } from "./status-badge";
import { formatBytes } from "./format";
import { useI18n } from "./i18n";

export function DocumentView({ id }: { id: string }) {
  const { t, label, formatDate } = useI18n();
  const session = useSession();
  const resource = useResource("GET /api/documents/[id]", { params: { id } });
  const custody = useResource("GET /api/audit", { query: { docId: id } });
  const verification = useResource("POST /api/documents/[id]/verify", { params: { id } });
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState<UploadReceipt | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [contentTampered, setContentTampered] = useState(false);

  // Moving to another document must not show the previous one's result.
  useEffect(() => {
    const timer = setTimeout(() => { setResult(null); setRestored(null); setContentTampered(false); }, 0);
    return () => clearTimeout(timer);
  }, [id]);

  if (resource.loading) return <PageSkeleton />;
  if (resource.error) return <ResourceError error={resource.error} retry={resource.reload} />;
  const doc = resource.data;
  if (!doc) return <EmptyState title={t("doc.unavailable")} description={t("doc.unavailableHelp")} />;
  const current = result ?? verification.data;

  async function verify() {
    setBusy(true);
    try {
      const next = await api("POST /api/documents/[id]/verify", { params: { id } });
      setResult(next);
      setContentTampered(next.status === "TAMPERED");
      toast.info(t("doc.checkDone", { status: label(next.status) }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("doc.checkFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function restore(reason: string) {
    setRestored(await api("POST /api/documents/[id]/restore", { params: { id }, body: { reason } }));
    toast.success(t("doc.recoveredToast"), { description: t("doc.recoveredToastDesc") });
  }

  async function download() {
    setDownloadBusy(true);
    try {
      const blob = await api("GET /api/documents/[id]/content", { params: { id }, query: { disposition: "attachment" } });
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = blob instanceof File ? blob.name : doc!.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 409) {
        setContentTampered(true);
        void verify();
      }
      toast.error(e instanceof Error ? e.message : t("doc.downloadFailed"));
    } finally {
      setDownloadBusy(false);
    }
  }

  const canDownload = !contentTampered && doc.canDownload && current?.status === "VERIFIED";
  const granted = doc.access.via === "GRANT";
  const breadcrumbs = granted
    ? [{ label: t("doc.crumbRequests"), href: "/requests" }, { label: t("doc.crumbGranted") }]
    : [{ label: t("doc.crumbCases"), href: "/cases" }, { label: t("doc.crumbCase"), href: "/cases/" + doc.caseId }, { label: t("doc.crumbDoc") }];

  const technical = (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <ExplainTerm term={t("tech.signature")} meaning={t("tech.signatureHelp")} />
          <p className="text-base">{doc.signature.algorithm}</p>
          <p className="text-sm text-muted-foreground">{doc.signature.signerName}</p>
        </div>
        <div>
          <ExplainTerm term={t("tech.hash")} meaning={t("tech.hashHelp")} />
          <CopyableHash value={doc.sha256} />
        </div>
        <div><p className="section-label">{t("tech.chunkRoot")}</p><CopyableHash value={doc.chunkRoot} /></div>
        <div><p className="section-label">{t("tech.publicKey")}</p><CopyableHash value={doc.signature.publicKeyHash} /></div>
        <div><p className="section-label">{t("tech.storage")}</p><p className="text-base">{t("tech.storageValue", { parts: doc.partCount, chunks: doc.chunkCount })}</p></div>
      </div>
      <BlockchainActivity docId={id} />
    </>
  );

  return (
    <div className="page-grid">
      <PageHeader
        title={doc.filename}
        description={label(doc.type) + " · " + t("doc.versionLine", { v: doc.version, size: formatBytes(doc.sizeBytes) })}
        breadcrumbs={breadcrumbs}
        action={<Button onClick={() => void verify()} disabled={busy || verification.loading}><RefreshCw />{busy ? t("doc.checking") : t("doc.check")}</Button>}
      />
      {contentTampered && (
        <InlineNotice danger>
          <strong>{t("doc.tamperedBanner")}</strong>
          <p>{t("doc.tamperedHelp")}</p>
        </InlineNotice>
      )}
      {doc.access.via === "GRANT" && (
        <InlineNotice>
          {t("doc.grant", { order: doc.access.orderRef, until: doc.access.expiresAt ? formatDate(doc.access.expiresAt) : t("doc.noEnd") })}
        </InlineNotice>
      )}
      {restored && (
        <SectionCard title={t("doc.recovered")} description={t("doc.recoveredHelp")}>
          <StatusBadge status={restored.verification.status} />
          <p className="mt-3 text-base">{t("doc.versionRow", { v: restored.document.version, name: restored.document.filename })}</p>
          <Button asChild variant="outline" className="mt-3"><Link href={"/documents/" + restored.document.id}>{t("doc.recoveredOpen")}</Link></Button>
          <p className="mt-2 text-sm text-muted-foreground">{t("doc.recoveredNext")}</p>
        </SectionCard>
      )}

      {verification.loading ? <PageSkeleton />
        : verification.error ? <ResourceError error={verification.error} retry={verification.reload} />
        : current && (!contentTampered || current.status === "TAMPERED") && (
          <IntegrityPanel
            result={current}
            documentName={doc.filename}
            canRestore={doc.canRestore && session.allowedUploadTypes.includes(doc.type)}
            onRestore={restore}
            extra={technical}
          />
        )}

      <SectionCard title={t("doc.about")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><p className="section-label">{t("doc.addedBy")}</p><p className="text-base">{doc.uploaderName}</p><RelativeTime at={doc.createdAt} /></div>
        </div>
        <div className="no-print mt-5 flex flex-wrap gap-2">
          <Button variant="outline" disabled={!canDownload || downloadBusy} onClick={() => void download()}>
            <Download />{t(granted ? "doc.downloadMarked" : "doc.download")}
          </Button>
          <PrintButton label={t("doc.print")} />
          {doc.canAddVersion && <UploadDialog secondary caseId={doc.caseId} parentId={id} allowedTypes={session.allowedUploadTypes} />}
        </div>
        {!canDownload && <p className="mt-2 text-sm text-muted-foreground">{t("doc.downloadNeed")}</p>}
      </SectionCard>

      <SectionCard title={t("doc.content")}>
        <DocumentPreview
          key={id + current?.status}
          id={id}
          mime={doc.mimeType}
          allowed={doc.canPreview && current?.status === "VERIFIED"}
          tampered={contentTampered || current?.status === "TAMPERED"}
          onTampered={() => { setContentTampered(true); void verify(); }}
        />
      </SectionCard>

      <SectionCard title={t("doc.custody")} description={t("doc.custodyHelp")}>
        {custody.loading ? <p role="status">{t("doc.custodyLoading")}</p>
          : custody.error ? <ResourceError error={custody.error} retry={custody.reload} />
          : custody.data?.items.length ? (
            <Timeline>
              {[...custody.data.items].sort((a, b) => a.at.localeCompare(b.at)).map(e => (
                <TimelineItem key={e.id} title={label(e.action) + " · " + e.actorName} at={e.at} danger={e.action === "DENIED" || e.action === "TAMPER_DETECTED"} detail={e.detail ?? undefined}>
                  <div className="mt-2"><LegalBasisView value={e.legalBasis} /></div>
                </TimelineItem>
              ))}
            </Timeline>
          ) : <p className="text-base text-muted-foreground">{t("doc.custodyNone")}</p>}
      </SectionCard>

      {doc.versions.length > 1 && (
        <SectionCard title={t("doc.versions")}>
          {doc.versions.map(v => (
            <div key={v.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-3 last:border-0">
              <div>
                <Link href={"/documents/" + v.id} className="text-base text-primary">{t("doc.versionRow", { v: v.version, name: v.filename })}</Link>
                <p><RelativeTime at={v.createdAt} /></p>
              </div>
              <StatusBadge status={v.verificationStatus} />
            </div>
          ))}
        </SectionCard>
      )}
    </div>
  );
}

function DocumentPreview({ id, mime, allowed, tampered, onTampered }: {
  id: string;
  mime: string;
  allowed: boolean;
  tampered: boolean;
  onTampered: () => void;
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  async function load() {
    setBusy(true);
    setError("");
    try {
      const blob = await api("GET /api/documents/[id]/content", { params: { id }, query: { disposition: "inline" } });
      setUrl(URL.createObjectURL(blob));
      if (mime === "text/plain") setText(await blob.text());
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 409) onTampered();
      setError(e instanceof Error ? e.message : t("doc.previewFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (tampered) return <p role="alert" className="text-base text-tampered">{t("doc.tamperedBanner")}</p>;
  if (!allowed) return <p className="text-base text-muted-foreground">{t("doc.previewNeed")}</p>;
  return (
    <div className="space-y-3">
      {!url && text === null && <Button variant="outline" disabled={busy} onClick={() => void load()}>{busy ? t("doc.previewLoading") : t("doc.preview")}</Button>}
      {error && <p role="alert" className="text-base text-tampered">{error}</p>}
      {text !== null && <pre className="max-h-[600px] overflow-auto whitespace-pre-wrap break-words border p-3 font-mono text-sm">{text}</pre>}
      {url && <Button asChild variant="outline"><a href={url} target="_blank" rel="noreferrer">{t("doc.previewTab")}</a></Button>}
      {url && mime !== "text/plain" && (
        mime.startsWith("image/")
          ? <Image src={url} unoptimized width={1000} height={1400} alt={t("doc.previewAlt")} className="max-h-[600px] max-w-full object-contain" />
          : mime === "application/pdf"
            ? <iframe title={t("doc.previewAlt")} src={url} className="h-[600px] w-full border" />
            : <p className="text-base text-muted-foreground">{t("doc.previewNone")}</p>
      )}
    </div>
  );
}
