"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { LogOut, Menu } from "lucide-react";
import { toast } from "sonner";
import type { Role, Session } from "@/types/api";
import { api, ApiClientError } from "@/components/api-client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";
import { Brand } from "./brand";
import { SessionContext } from "./session";
import { useResource } from "./use-resource";
import { AccessDenied, ResourceError } from "./access-state";
import { PageSkeleton } from "./design-system";
import { TrustStrip } from "./trust-strip";
import { LanguageSwitcher } from "./language-switcher";
import { useI18n } from "./i18n";
import type { MessageKey } from "./i18n/en";

export function roleHome(role: Role) {
  return role === "DEFENCE_ADVOCATE" ? "/requests" : "/dashboard";
}

type NavItem = { href: string; label: MessageKey };

function linksFor(role: Role): NavItem[] {
  if (role === "COMPLAINANT") return [{ href: "/dashboard", label: "nav.progress" }];
  if (role === "DEFENCE_ADVOCATE") return [{ href: "/requests", label: "nav.docRequests" }];
  const items: NavItem[] = [
    { href: "/dashboard", label: "nav.home" },
    { href: "/cases", label: role === "POLICE" ? "nav.myCases" : role === "FORENSIC_LAB" ? "nav.assigned" : "nav.cases" },
  ];
  if (role === "JUDGE") items.push({ href: "/requests", label: "nav.decide" });
  if (["JUDGE", "ADMIN", "PUBLIC_PROSECUTOR"].includes(role)) {
    items.push(
      { href: "/integrity", label: "nav.checks" },
      { href: "/audit", label: "nav.activity" },
      { href: "/batches", label: "nav.blockchain" },
    );
  }
  return items;
}

function isRestricted(role: Role, pathname: string) {
  if (role === "COMPLAINANT") return !((pathname.startsWith("/cases/") && pathname.endsWith("/progress")) || pathname === "/dashboard");
  if (role === "DEFENCE_ADVOCATE") return !(pathname === "/requests" || pathname.startsWith("/documents/"));
  return false;
}

/** Everything in the side rail: brand, pages, language, the signed-in person. */
function RailContent({ session, pathname, onNavigate }: { session: Session; pathname: string; onNavigate: () => void }) {
  const { t, label } = useI18n();
  const router = useRouter();
  const user = session.user;

  async function signOut() {
    try {
      await api("POST /api/auth/logout", {});
      router.push("/login");
    } catch {
      toast.error(t("shell.signOutFailed"));
    }
  }

  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="px-2 pt-2"><Brand href={roleHome(user.role)} /></div>
      <nav aria-label="Primary" className="grid gap-1">
        {linksFor(user.role).map(({ href, label: text }) => {
          const active = pathname === href || (href === "/cases" && pathname.startsWith("/cases/"));
          return <Link key={href} href={href} aria-current={active ? "page" : undefined} onClick={onNavigate} className="nav-link">{t(text)}</Link>;
        })}
      </nav>
      <div className="mt-auto grid gap-4 border-t border-border px-2 pt-4">
        <LanguageSwitcher />
        <div>
          <p className="font-semibold">{user.name}</p>
          <p className="text-sm text-muted-foreground">{label(user.role)}</p>
          <p className="text-sm text-muted-foreground">{user.station}</p>
        </div>
        <button onClick={signOut} className="flex min-h-11 items-center gap-2 text-left text-sm font-semibold hover:underline">
          <LogOut className="size-4" />{t("shell.signOut")}
        </button>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const session = useResource("GET /api/auth/session", {});
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (session.error instanceof ApiClientError && session.error.status === 401) router.replace("/login");
  }, [session.error, router]);

  if (session.loading) return <main className="p-6"><PageSkeleton /></main>;
  if (session.error || !session.data) {
    return <main className="p-6"><ResourceError error={session.error || new Error(t("shell.noSession"))} retry={session.reload} /></main>;
  }
  const data = session.data;

  return (
    <SessionContext.Provider value={data}>
      <div className="min-h-dvh">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:bg-card focus:p-3">{t("shell.skip")}</a>
        <header data-app-header className="rail sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b px-3 lg:hidden">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t("shell.openMenu")}><Menu /></Button>
            </SheetTrigger>
            <SheetContent side="left" className="rail w-72 border-0 p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>{t("shell.menuTitle")}</SheetTitle>
                <SheetDescription>{t("shell.menuDesc")}</SheetDescription>
              </SheetHeader>
              <RailContent session={data} pathname={pathname} onNavigate={() => setMenuOpen(false)} />
            </SheetContent>
          </Sheet>
          <span><Brand href={roleHome(data.user.role)} /></span>
        </header>
        <aside className="rail fixed inset-y-0 left-0 hidden w-64 lg:block">
          <RailContent session={data} pathname={pathname} onNavigate={() => {}} />
        </aside>
        <div className="app-body min-w-0 lg:pl-64">
          <main id="main-content" className="min-h-[80vh] min-w-0 px-4 py-6 sm:px-8 sm:py-10">
            {isRestricted(data.user.role, pathname) ? <AccessDenied /> : children}
          </main>
          {data.user.role !== "COMPLAINANT" && <TrustStrip />}
        </div>
      </div>
    </SessionContext.Provider>
  );
}
