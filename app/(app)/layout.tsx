import { AppShell } from "@/components/quantumshield/app-shell";
export default function ProtectedLayout({ children }: {
    children: React.ReactNode;
}) { return <AppShell>{children}</AppShell>; }
