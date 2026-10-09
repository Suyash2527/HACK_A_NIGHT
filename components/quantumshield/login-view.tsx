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
import { LanguageSwitcher } from "./language-switcher";
import { useI18n } from "./i18n";

// Demo accounts are named after the role; the shared password comes from the administrator.
const ROLES: { role: Role; account: string }[] = [
  { role: "POLICE", account: "police" },
  { role: "FORENSIC_LAB", account: "lab" },
  { role: "PUBLIC_PROSECUTOR", account: "prosecutor" },
  { role: "JUDGE", account: "judge" },
  { role: "ADMIN", account: "admin" },
  { role: "DEFENCE_ADVOCATE", account: "advocate" },
  { role: "COMPLAINANT", account: "complainant" },
];

export function LoginView() {
  const router = useRouter();
  const { t, label } = useI18n();
  const [role, setRole] = useState<Role>("POLICE");
  const [email, setEmail] = useState("police@sakshya.demo");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // A visitor who is already signed in goes straight to their home page.
  useEffect(() => {
    const controller = new AbortController();
    api("GET /api/auth/session", { signal: controller.signal })
      .then(session => { if (!controller.signal.aborted) router.replace(roleHome(session.user.role)); })
      .catch(() => {});
    return () => controller.abort();
  }, [router]);

  function choose(next: Role, account: string) {
    setRole(next);
    setEmail(account + "@sakshya.demo");
    setError("");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError(t("login.needBoth"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const session = await api("POST /api/auth/login", { body: { email: email.trim(), password } });
      setPassword("");
      router.replace(roleHome(session.user.role));
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("login.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <section className="flex flex-col justify-between gap-10 border-b bg-card px-6 py-8 sm:px-12 lg:border-b-0 lg:border-r lg:py-12">
        <Brand href="/login" />
        <div>
          <p lang="hi" aria-hidden="true" className="select-none text-[64px] font-extrabold leading-none text-foreground sm:text-[96px]">साक्ष्य</p>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-muted-foreground">{t("trust.line")}</p>
        </div>
        <LanguageSwitcher />
      </section>
      <section className="flex items-start justify-center px-4 py-10 sm:px-10 lg:items-center">
        <div className="w-full max-w-2xl">
          <h1 className="text-[32px] font-bold leading-tight">{t("login.title")}</h1>
          <p className="mb-6 mt-1 text-lg text-muted-foreground">{t("login.choose")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {ROLES.map(item => (
              <button key={item.role} type="button" className="authority-button" aria-pressed={role === item.role} onClick={() => choose(item.role, item.account)}>
                <strong>{label(item.role)}</strong>
                <span>{t(`hint.${item.role}`)}</span>
              </button>
            ))}
          </div>
          <form className="mt-8 grid gap-4 sm:grid-cols-2" onSubmit={submit}>
            <div className="space-y-1">
              <Label htmlFor="login-email">{t("login.email")}</Label>
              <Input id="login-email" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="login-password">{t("login.password")}</Label>
              <Input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
            </div>
            {error && <p role="alert" className="text-base text-tampered sm:col-span-2">{error}</p>}
            <Button type="submit" size="lg" className="sm:col-span-2" disabled={busy}>{busy ? t("login.busy") : t("login.submit")}</Button>
            <p className="text-sm text-muted-foreground sm:col-span-2">{t("login.sharedPassword")}</p>
          </form>
        </div>
      </section>
    </main>
  );
}
