import type { Metadata } from "next";
import { CasesView } from "@/components/quantumshield/cases-view";
export const metadata: Metadata = { title: "Cases", description: "Assigned case records and evidence status." };
export default function CasesPage() { return <CasesView />; }
