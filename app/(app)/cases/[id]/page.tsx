import type { Metadata } from "next";
import { CaseDetailView } from "@/components/quantumshield/case-detail-view";
export const metadata: Metadata = { title: "Case evidence" };
export default async function Page({ params }: PageProps<"/cases/[id]">) { const { id } = await params; return <CaseDetailView key={id} id={id}/>; }
