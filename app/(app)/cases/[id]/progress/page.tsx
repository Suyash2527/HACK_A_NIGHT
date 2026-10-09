import type { Metadata } from "next";
import { ProgressTimeline } from "@/components/quantumshield/progress-timeline";
export const metadata: Metadata = { title: "Case progress" };
export default async function Page({ params }: PageProps<"/cases/[id]/progress">) { const { id } = await params; return <ProgressTimeline key={id} caseId={id}/>; }
