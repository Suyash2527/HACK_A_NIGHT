import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/quantumshield/brand";
import { EmptyState } from "@/components/quantumshield/design-system";
import { Button } from "@/components/ui/button";
export const metadata: Metadata = { title: "Record unavailable" };
export default function NotFound() { return <main className="mx-auto min-h-dvh max-w-3xl p-6"><Brand href="/login"/><EmptyState title="Record unavailable" description="This link may be incorrect, or the record may not be available to you. Sign in to return to your permitted workspace." action={<Button asChild><Link href="/login">Return to sign in</Link></Button>}/></main>; }
