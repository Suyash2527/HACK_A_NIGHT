"use client";
import { createContext, useContext } from "react";
import type { Session } from "@/types/api";
export const SessionContext = createContext<Session | null>(null);
export function useSession() { const session = useContext(SessionContext); if (!session)
    throw new Error("Session is required"); return session; }
