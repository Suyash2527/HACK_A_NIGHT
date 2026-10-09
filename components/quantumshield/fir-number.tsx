"use client";
import { FIR_NUMBER_PATTERN } from "@/types/api";
import { useI18n } from "./i18n";

/** The last four characters are the register's verification code, shown as a small badge. */
export function FirNumber({ value }: { value: string }) {
  const { t } = useI18n();
  if (!FIR_NUMBER_PATTERN.test(value)) return <span className="break-all font-mono">{value}</span>;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-1 font-mono tracking-normal">
      <span>{value.slice(0, -4)}</span>
      <span className="rounded border border-primary/20 bg-accent px-1.5 py-0.5 text-[0.75em] font-semibold text-primary" title={t("fir.codeTitle")}>{value.slice(-4)}</span>
    </span>
  );
}
