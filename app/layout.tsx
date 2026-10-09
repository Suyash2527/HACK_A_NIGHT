import type { Metadata } from "next"
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import "./globals.css"

const plexSans = IBM_Plex_Sans({ variable: "--font-plex-sans", subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" })
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"], display: "swap" })

export const metadata: Metadata = { title: { default: "Sakshya", template: "%s · Sakshya" }, description: "Traceable judicial evidence with off-chain post-quantum signatures and verifiable integrity", icons: { icon: "/icon.svg" } }

export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`} suppressHydrationWarning><body><ThemeProvider>{children}<Toaster position="top-right" /></ThemeProvider></body></html>
}
