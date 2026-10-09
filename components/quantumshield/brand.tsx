"use client";
import Link from "next/link";
import { useI18n } from "./i18n";

/** Wordmark: a brass seal with the Devanagari initial, then the name. */
export function Brand({ href = "/dashboard" }: { href?: string }) {
  const { t } = useI18n();
  return (
    <Link href={href} aria-label={t("shell.homeLabel")} className="wordmark shrink-0">
      <span className="seal" aria-hidden="true">स</span>
      Sakshya
      <span lang="hi" className="text-base font-medium text-muted-foreground">साक्ष्य</span>
    </Link>
  );
}
