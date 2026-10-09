import type { Metadata } from "next";
import { AuditView } from "@/components/quantumshield/audit-view";
export const metadata: Metadata = { title: "Audit trail" };
export default function Page() { return <AuditView />; }
