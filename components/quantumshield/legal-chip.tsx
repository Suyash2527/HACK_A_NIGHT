"use client";
import type { LegalRef, ExcludedDoc } from "@/types/api";
import Link from "next/link";
import { useI18n } from "./i18n";
import { StatusBadge } from "./status-badge";

export function LegalChip({ value }: { value: LegalRef }) {
  const { t } = useI18n();
  return <div className="min-w-0 max-w-full border bg-muted/50 px-2 py-1 text-xs">
    <details><summary className="cursor-pointer break-words font-medium">{value.ref}</summary>
      <div className="max-w-prose space-y-1 py-2 text-sm [overflow-wrap:anywhere]"><p className="font-semibold">{value.title}</p><p>{value.text}</p></div>
    </details>
    <p className="text-muted-foreground">{t("assistant.summary")}</p>
  </div>;
}

export function LegalChips({ items }: { items: LegalRef[] }) {
  return <div className="flex min-w-0 flex-wrap gap-2">{items.map(item => <LegalChip key={item.id} value={item} />)}</div>;
}

export function ExcludedDocuments({ items }: { items: ExcludedDoc[] }) {
  const { t } = useI18n();
  if (!items.length) return null;
  return <div className="space-y-2 border border-tampered bg-tampered/5 p-3 text-tampered">
    <h3 className="font-semibold">{t("assistant.excluded")}</h3>
    <ul className="divide-y divide-tampered/20">{items.map(item => <li key={item.docId} className="space-y-1 py-2 [overflow-wrap:anywhere]">
      <Link className="underline" href={"/documents/" + item.docId}>{item.filename}</Link> <StatusBadge status={item.status} />
      <p className="text-sm">{item.reason}</p>
    </li>)}</ul>
  </div>;
}
