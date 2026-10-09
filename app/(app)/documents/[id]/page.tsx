import type { Metadata } from "next";
import { DocumentView } from "@/components/quantumshield/document-view";
export const metadata: Metadata = { title: "Evidence integrity certificate" };
export default async function Page({ params }: PageProps<"/documents/[id]">) { const { id } = await params; return <DocumentView key={id} id={id}/>; }
