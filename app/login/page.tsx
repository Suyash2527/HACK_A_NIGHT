import type { Metadata } from "next";
import { LoginView } from "@/components/quantumshield/login-view";
export const metadata: Metadata = { title: "Sign in" };
export default function Page() { return <LoginView />; }
