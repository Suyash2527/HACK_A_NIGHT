import type { Metadata } from "next";
import { BatchesView } from "@/components/quantumshield/batches-view";
export const metadata: Metadata = { title: "Blockchain receipts" };
export default function Page() { return <BatchesView />; }
