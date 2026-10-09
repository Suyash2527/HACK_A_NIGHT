import type { Metadata } from "next";
import { Brand } from "@/components/quantumshield/brand";
import { PublicVerifyUnavailable } from "@/components/quantumshield/unavailable";
import { TrustStrip } from "@/components/quantumshield/trust-strip";

export const metadata: Metadata = { title: "Public verification" };

export default async function Page({ params }: PageProps<"/verify/[docId]">) {
  await params;
  return (
    <main className="min-h-dvh bg-background">
      <header className="border-b bg-card p-5"><Brand href="/login" /></header>
      <PublicVerifyUnavailable />
      <TrustStrip />
    </main>
  );
}
