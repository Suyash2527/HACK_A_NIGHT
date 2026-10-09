import type { Metadata } from "next";
import { RequestsWorkspace } from "@/components/quantumshield/requests-workspace";
export const metadata: Metadata = { title: "Court access requests" };
export default function Page() { return <RequestsWorkspace />; }
