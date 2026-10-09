"use client";
import Link from "next/link";
import { LockKeyhole, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiClientError } from "@/components/api-client";
import { EmptyState } from "./design-system";
import { useI18n } from "./i18n";

export function AccessDenied({ audited = false }: { audited?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex items-start gap-3">
      <LockKeyhole className="mt-6 size-6 shrink-0 text-tampered" />
      <EmptyState
        title={t("err.deniedTitle")}
        description={t(audited ? "err.deniedAudited" : "err.deniedRole")}
        action={<Button variant="outline" asChild><Link href="/login">{t("common.signIn")}</Link></Button>}
      />
    </div>
  );
}

export function ResourceError({ error, retry }: { error: Error; retry: () => void }) {
  const { t } = useI18n();
  const status = error instanceof ApiClientError ? error.status : 0;
  if (status === 403) return <AccessDenied audited />;
  const [title, help] =
    status === 401 ? (["err.sessionEnded", "err.genericHelp"] as const)
    : status === 404 ? (["err.notFound", "err.notFoundHelp"] as const)
    : status === 503 ? (["err.serviceDown", "err.serviceDownHelp"] as const)
    : (["err.generic", "err.genericHelp"] as const);
  return (
    <div className="flex items-start gap-3">
      <AlertTriangle className="mt-6 size-6 shrink-0 text-tampered" />
      <EmptyState
        title={t(title)}
        description={t(help)}
        action={<div className="flex gap-2"><Button onClick={retry}>{t("common.tryAgain")}</Button><Button variant="outline" asChild><Link href="/login">{t("common.signIn")}</Link></Button></div>}
      />
    </div>
  );
}

/** Shown by app/not-found.tsx, which is a server component and cannot call hooks itself. */
export function RecordUnavailable() {
  const { t } = useI18n();
  return (
    <EmptyState
      title={t("notfound.title")}
      description={t("notfound.help")}
      action={<Button asChild><Link href="/login">{t("common.signIn")}</Link></Button>}
    />
  );
}
