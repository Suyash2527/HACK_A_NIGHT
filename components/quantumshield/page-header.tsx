import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export function PageHeader({ title, description, action, breadcrumbs = [] }: {
  title: ReactNode;
  description: string;
  action?: ReactNode;
  breadcrumbs?: { label: ReactNode; href?: string }[];
}) {
  return (
    <div className="page-heading">
      {breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          {breadcrumbs.map((b, i) => (
            <span className="inline-flex items-center gap-1.5" key={i}>
              {i > 0 && <ChevronRight className="size-3" />}
              {b.href ? <Link href={b.href} className="hover:text-primary">{b.label}</Link> : <span aria-current="page">{b.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <h1>{title}</h1>
          <p className="mt-1 max-w-xl text-base text-muted-foreground">{description}</p>
        </div>
        <div className="no-print flex shrink-0 flex-wrap items-center gap-2">{action}</div>
      </div>
    </div>
  );
}
