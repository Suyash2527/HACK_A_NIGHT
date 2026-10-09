import type { Metadata } from "next";
import { Unavailable } from "@/components/quantumshield/unavailable";
export const metadata: Metadata = { title: "Case assistant" };
export default function Page() { return <Unavailable feature="Case assistant" detail="Amazon Bedrock retrieval is unavailable in this build. Evidence access and integrity workflows remain available."/>; }
