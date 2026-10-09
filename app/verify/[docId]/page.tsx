import type { Metadata } from "next";
import { Brand } from "@/components/quantumshield/brand";
import { Unavailable } from "@/components/quantumshield/unavailable";
import { TrustStrip } from "@/components/quantumshield/trust-strip";
import {} from "@/components/api-client";
export const metadata: Metadata = { title: "Public verification" };
export default async function Page({ params }: PageProps<"/verify/[docId]">) { await params; return <main className="min-h-dvh bg-background"><header className="border-b bg-card p-5"><Brand href="/login"/></header><Unavailable feature="Public verification" detail="Public proof receipts are unavailable in this build. Sign in to inspect authorized evidence."/><TrustStrip /></main>; }
