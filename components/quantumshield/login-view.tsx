"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@/types/api";
import { api } from "@/components/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Brand } from "./brand";
import { roleHome } from "./app-shell";
import { TRUST_COPY } from "./trust-strip";
const authorities = [
    { name: "POLICE", role: "POLICE" as Role, email: "police", hint: "Register cases and upload police documents." },
    { name: "FORENSIC LABORATORY", role: "FORENSIC_LAB" as Role, email: "lab", hint: "View assigned cases and upload reports." },
    { name: "COURT", role: "JUDGE" as Role, email: "judge", hint: "Review cases, document requests and integrity." },
    { name: "ADMINISTRATION", role: "ADMIN" as Role, email: "admin", hint: "Check audit chains, FIR register, scans and batches." },
];
export function LoginView() {
    const router = useRouter();
    const [role, setRole] = useState<Role>("POLICE"), [email, setEmail] = useState("police@sakshya.demo"), [password, setPassword] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
    useEffect(() => {
        const controller = new AbortController();
        async function resume() {
            try {
                const session = await api("GET /api/auth/session", { signal: controller.signal });
                let home = roleHome(session.user.role);
                if (session.user.role === "COMPLAINANT") {
                    const cases = await api("GET /api/cases", { query: { limit: 1 }, signal: controller.signal });
                    if (cases.items[0])
                        home = "/cases/" + cases.items[0].id + "/progress";
                }
                if (!controller.signal.aborted)
                    router.replace(home);
            }
            catch { /* An unauthenticated visitor stays on the sign-in form. */ }
        }
        void resume();
        return () => controller.abort();
    }, [router]);
    function choose(next: Role, address: string) { setRole(next); setEmail(address + "@sakshya.demo"); setError(""); }
    async function submit(e: FormEvent) {
        e.preventDefault();
        if (!email.trim() || !password) {
            setError("Enter email and password.");
            return;
        }
        setBusy(true);
        setError("");
        try {
            const session = await api("POST /api/auth/login", { body: { email: email.trim(), password } });
            setPassword("");
            if (session.user.role === "COMPLAINANT") {
                const cases = await api("GET /api/cases", { query: { limit: 1 } });
                router.replace(cases.items.length ? "/cases/" + cases.items[0].id + "/progress" : "/dashboard");
            }
            else
                router.replace(roleHome(session.user.role));
            router.refresh();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "Sign in failed");
        }
        finally {
            setBusy(false);
        }
    }
    return <main className="min-h-dvh px-3 py-6"><div className="mx-auto max-w-lg"><Brand href="/login"/><section className="mt-5 border p-4 sm:p-6"><h1 className="mb-5 text-[22px] font-semibold">Sign in</h1><div className="grid gap-2 sm:grid-cols-2" aria-label="Authority">{authorities.map(a => <button key={a.name} type="button" className="authority-button" aria-pressed={a.name === "COURT" ? ["JUDGE", "PUBLIC_PROSECUTOR"].includes(role) : role === a.role} onClick={() => choose(a.role, a.email)}><strong>{a.name}</strong><span>{a.hint}</span></button>)}</div>{["JUDGE", "PUBLIC_PROSECUTOR"].includes(role) && <div className="mt-3 flex gap-4 text-xs"><button type="button" className="text-[#c2410c] underline" aria-pressed={role === "JUDGE"} onClick={() => choose("JUDGE", "judge")}>Judge</button><button type="button" className="text-[#c2410c] underline" aria-pressed={role === "PUBLIC_PROSECUTOR"} onClick={() => choose("PUBLIC_PROSECUTOR", "prosecutor")}>Public Prosecutor</button></div>}<form className="mt-5 space-y-4" onSubmit={submit}><div className="space-y-1"><Label htmlFor="login-email">Email</Label><Input id="login-email" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)}/><p className="text-xs text-muted-foreground">Demo account: <span className="font-mono">{email}</span></p></div><div className="space-y-1"><Label htmlFor="login-password">Password</Label><Input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)}/></div>{error && <p role="alert" className="text-sm text-tampered">{error}</p>}<Button type="submit" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button></form><div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t pt-3 text-xs"><button className="text-[#c2410c] underline" onClick={() => choose("DEFENCE_ADVOCATE", "advocate")}>Defence Advocate</button><button className="text-[#c2410c] underline" onClick={() => choose("COMPLAINANT", "complainant")}>Complainant</button></div><p className="mt-4 text-xs text-muted-foreground">Use the shared demo password provided by the administrator.</p></section><p className="mt-5 text-[11px] leading-5 text-muted-foreground">{TRUST_COPY}</p></div></main>;
}
