import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Mukta, IBM_Plex_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { I18nProvider } from "@/components/quantumshield/i18n";
import { LANGUAGE_COOKIE, parseLanguage } from "@/components/quantumshield/i18n/languages";
import "./globals.css";

// Mukta (Ek Type, India) draws Latin and Devanagari in one voice, so English, Hindi and Marathi match.
const ui = Mukta({ variable: "--font-ui", subsets: ["latin", "devanagari"], weight: ["400", "500", "600", "700", "800"], display: "swap" });
// Monospace only where characters must be read one by one: FIR numbers and fingerprints.
const code = IBM_Plex_Mono({ variable: "--font-code", subsets: ["latin"], weight: ["400", "500"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Sakshya", template: "%s · Sakshya" },
  description: "Traceable judicial evidence with off-chain post-quantum signatures and verifiable integrity",
  icons: { icon: "/icon.svg" },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const lang = parseLanguage((await cookies()).get(LANGUAGE_COOKIE)?.value);
  return (
    <html lang={lang} className={`${ui.variable} ${code.variable}`} suppressHydrationWarning>
      <body>
        <I18nProvider initial={lang}>
          <ThemeProvider>{children}<Toaster position="top-right" /></ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
