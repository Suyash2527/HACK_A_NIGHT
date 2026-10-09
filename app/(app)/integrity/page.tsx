import type { Metadata } from "next";
import { IntegrityView } from "@/components/quantumshield/integrity-view";
export const metadata: Metadata = { title: "Integrity monitor" };
export default function Page() { return <IntegrityView />; }
