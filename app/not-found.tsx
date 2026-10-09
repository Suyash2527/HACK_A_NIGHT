import type { Metadata } from "next";
import { Brand } from "@/components/quantumshield/brand";
import { RecordUnavailable } from "@/components/quantumshield/access-state";

export const metadata: Metadata = { title: "Not available" };

export default function NotFound() {
  return <main className="mx-auto min-h-dvh max-w-3xl p-6"><Brand href="/login" /><RecordUnavailable /></main>;
}
