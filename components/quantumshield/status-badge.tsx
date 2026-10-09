"use client";
import { AlertTriangle, CheckCircle2, CircleDashed, Clock3, HelpCircle } from "lucide-react";
import type { VerifyStatus } from "@/types/api";
import { useI18n } from "./i18n";

const tones = {
  VERIFIED: { icon: CheckCircle2, tone: "tone-verified" },
  TAMPERED: { icon: AlertTriangle, tone: "tone-danger" },
  PENDING_ANCHOR: { icon: Clock3, tone: "tone-pending" },
  UNANCHORED: { icon: CircleDashed, tone: "tone-neutral" },
  ERROR: { icon: HelpCircle, tone: "tone-danger" },
} satisfies Record<VerifyStatus, { icon: typeof CheckCircle2; tone: string }>;

export function StatusBadge({ status }: { status: VerifyStatus | null }) {
  const { label } = useI18n();
  const item = status ? tones[status] : { icon: CircleDashed, tone: "tone-neutral" };
  return (
    <span role="status" aria-live="polite" className={"status-pill " + item.tone}>
      <item.icon className="size-3.5" aria-hidden="true" />
      {label(status ?? "UNCHECKED")}
    </span>
  );
}
