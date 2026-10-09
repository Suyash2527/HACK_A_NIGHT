"use client";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowDownUp, Check, ChevronLeft, ChevronRight, Copy, FileText, Image as ImageIcon, Info, Printer, Search } from "lucide-react";
import { toast } from "sonner";
import type { AllowedMime, ISODate, LegalBasis } from "@/types/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "./i18n";

const PAGE_SIZE = 20;
// Search only helps once a list is long enough to need it.
const SEARCH_FROM = 8;

export function CopyableHash({ value, label }: { value: string | null; label?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const name = label ?? t("hash.label");
  if (!value) return <span className="text-sm text-muted-foreground">{t("common.notRecorded")}</span>;
  async function copy() {
    try {
      await navigator.clipboard.writeText(value!);
      setCopied(true);
      toast.success(t("hash.copied", { label: name }));
    } catch {
      toast.error(t("hash.copyFailed"));
    }
  }
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <details className="min-w-0">
        <summary className="cursor-pointer font-mono text-xs text-muted-foreground" title={value}>{value.slice(0, 8)}…{value.slice(-6)}</summary>
        <span className="hash-value block max-w-60 py-2">{value}</span>
      </details>
      <Button variant="ghost" size="icon-sm" className="no-print shrink-0" onClick={copy} aria-label={t("hash.copy", { label: name })}>
        {copied ? <Check /> : <Copy />}
      </Button>
      <span className="print-only hash-value">{value}</span>
    </span>
  );
}

export function SectionCard({ title, description, action, children, className = "" }: {
  title?: ReactNode;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      {title && (
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>{title}</CardTitle>
              {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
            </div>
            {action}
          </div>
        </CardHeader>
      )}
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Folds technical proof away so ordinary readers see the plain answer first. */
export function TechnicalDetails({ title, open = false, children }: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="technical-details" open={open}>
      <summary>{title}</summary>
      <div className="space-y-5 pt-4">{children}</div>
    </details>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="space-y-2 py-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
      {action}
    </div>
  );
}

export function PageSkeleton() {
  const { t } = useI18n();
  return (
    <div aria-busy="true" aria-label={t("common.loading")} className="page-grid">
      <Skeleton className="h-7 w-40" />
      <div className="border">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-9 w-full border-b" />)}</div>
    </div>
  );
}

export function InlineNotice({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return (
    <div role={danger ? "alert" : "status"} className={"flex items-start gap-2 border p-3 text-sm " + (danger ? "tone-danger" : "tone-info")}>
      <Info className="mt-0.5 size-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

export function LegalBasisView({ value }: { value: LegalBasis }) {
  const { label } = useI18n();
  return (
    <div className="max-w-xs whitespace-normal text-sm">
      <p className="font-medium">{label(value.code)}</p>
      {value.citation && <p className="mt-1 text-muted-foreground">{value.citation}</p>}
      {value.orderRef && <p className="mt-1 font-medium text-primary">{value.orderRef}</p>}
    </div>
  );
}

export function RelativeTime({ at }: { at: ISODate | null }) {
  const { t, formatDate } = useI18n();
  if (!at) return <span className="text-sm text-muted-foreground">{t("common.notRecorded")}</span>;
  return <time dateTime={at} className="font-mono text-xs text-muted-foreground">{formatDate(at)}</time>;
}

export function FileIcon({ mime }: { mime: AllowedMime }) {
  const Icon = mime.startsWith("image") ? ImageIcon : FileText;
  return <span className="grid size-5 shrink-0 place-items-center text-muted-foreground"><Icon className="size-5" /></span>;
}

export function PrintButton({ label }: { label: string }) {
  return <Button className="no-print" variant="outline" onClick={() => window.print()}><Printer />{label}</Button>;
}

export function Timeline({ children }: { children: ReactNode }) {
  return <ol className="timeline">{children}</ol>;
}

export function TimelineItem({ title, detail, at, danger = false, children }: {
  title: string;
  detail?: string;
  at?: ISODate;
  danger?: boolean;
  children?: ReactNode;
}) {
  return (
    <li>
      <span className={"timeline-dot " + (danger ? "text-tampered" : "text-primary")}><span className="size-1.5 rounded-full bg-current" /></span>
      <div className="flex flex-wrap items-center justify-between gap-1">
        <p className="text-base font-medium">{title}</p>
        {at && <RelativeTime at={at} />}
      </div>
      {detail && <p className="mt-1 text-sm text-muted-foreground">{detail}</p>}
      {children}
    </li>
  );
}

interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  sort?: (row: T) => string | number;
}

export function DataTable<T>({ rows, columns, rowKey, searchText, resetKey = "", empty, emptyHelp, searchLabel }: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  searchText: (row: T) => string;
  resetKey?: string;
  empty?: string;
  /** Shown when there are no rows at all, to say what to do next. */
  emptyHelp?: string;
  searchLabel?: string;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: string; asc: boolean } | null>(null);
  const [page, setPage] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setPage(0), 0);
    return () => clearTimeout(timer);
  }, [resetKey]);
  const filtered = rows.filter(r => searchText(r).toLowerCase().includes(query.toLowerCase()));
  const column = columns.find(c => c.key === sort?.key);
  if (column?.sort) {
    filtered.sort((a, b) => String(column.sort!(a)).localeCompare(String(column.sort!(b)), undefined, { numeric: true }) * (sort?.asc ? 1 : -1));
  }
  const count = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, count - 1);
  const label = searchLabel ?? t("tbl.search");
  return (
    <div className="min-w-0">
      {rows.length >= SEARCH_FROM && (
        <div className="no-print relative mb-4 max-w-sm">
          <Search className="absolute left-3 top-3.5 size-4 text-muted-foreground" />
          <Input aria-label={label} placeholder={label} value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} className="pl-9" />
        </div>
      )}
      {filtered.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map(c => (
                <TableHead key={c.key} aria-sort={sort?.key === c.key ? (sort.asc ? "ascending" : "descending") : undefined}>
                  {c.sort ? (
                    <button className="flex min-h-8 items-center gap-1 text-left" onClick={() => setSort({ key: c.key, asc: sort?.key === c.key ? !sort.asc : true })}>
                      {c.label}<ArrowDownUp className="size-3" />
                    </button>
                  ) : c.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(r => (
              <TableRow key={rowKey(r)}>{columns.map(c => <TableCell key={c.key}>{c.render(r)}</TableCell>)}</TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <EmptyState title={rows.length ? t("tbl.empty") : empty ?? t("tbl.empty")} description={rows.length || !emptyHelp ? t("tbl.emptyHelp") : emptyHelp} action={query ? <Button variant="outline" onClick={() => setQuery("")}>{t("tbl.clearSearch")}</Button> : undefined} />
      )}
      {filtered.length > 0 && (
        <div className="no-print mt-4 flex items-center justify-between border-t pt-3 text-sm text-muted-foreground">
          <span>{t("tbl.records", { n: filtered.length })} · {t("tbl.page", { page: current + 1, pages: count })}</span>
          <div className="flex gap-1">
            <Button aria-label={t("tbl.prev")} size="icon-sm" variant="outline" disabled={current === 0} onClick={() => setPage(current - 1)}><ChevronLeft /></Button>
            <Button aria-label={t("tbl.next")} size="icon-sm" variant="outline" disabled={current + 1 >= count} onClick={() => setPage(current + 1)}><ChevronRight /></Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A technical word with a one-line plain explanation on hover, focus or tap. */
export function ExplainTerm({ term, meaning }: { term: string; meaning: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="text-left text-sm underline decoration-dotted underline-offset-4" aria-label={term + ". " + meaning}>{term}</button>
        </TooltipTrigger>
        <TooltipContent>{meaning}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
