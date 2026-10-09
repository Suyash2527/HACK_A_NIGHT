import { AlertTriangle, CheckCircle2, CircleDashed, Clock3, HelpCircle } from "lucide-react";
import type { VerifyStatus } from "@/types/api";
const details = {
    VERIFIED: { label: "Verified", icon: CheckCircle2, tone: "tone-verified" },
    TAMPERED: { label: "Tampered", icon: AlertTriangle, tone: "tone-danger" },
    PENDING_ANCHOR: { label: "Pending anchor", icon: Clock3, tone: "tone-pending" },
    UNANCHORED: { label: "Not anchored", icon: CircleDashed, tone: "tone-neutral" },
    ERROR: { label: "Could not verify", icon: HelpCircle, tone: "tone-danger" },
} satisfies Record<VerifyStatus, {
    label: string;
    icon: typeof CheckCircle2;
    tone: string;
}>;
export function StatusBadge({ status }: {
    status: VerifyStatus | null;
}) { const item = status ? details[status] : { label: "Not checked", icon: CircleDashed, tone: "tone-neutral" }; return <span role="status" aria-live="polite" className={"status-pill " + item.tone}><item.icon className="size-3.5" aria-hidden="true"/>{item.label}</span>; }
