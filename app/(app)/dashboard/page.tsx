import type { Metadata } from "next";
import { DashboardView } from "@/components/quantumshield/dashboard-view";
export const metadata: Metadata = { title: "Overview", description: "Case priorities and evidence integrity at a glance." };
export default function DashboardPage() { return <DashboardView />; }
