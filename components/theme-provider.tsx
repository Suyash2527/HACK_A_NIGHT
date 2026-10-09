"use client"
import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <NextThemesProvider attribute="class" defaultTheme="dark" forcedTheme="dark" storageKey="sakshya-appearance" enableSystem={false} disableTransitionOnChange>{children}</NextThemesProvider>
}
