"use client";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { en, type MessageKey } from "./en";
import { hi } from "./hi";
import { mr } from "./mr";
import { LANGUAGE_COOKIE, type Language } from "./languages";


const dictionaries: Record<Language, Record<MessageKey, string>> = { en, hi, mr };
const locales: Record<Language, string> = { en: "en-IN", hi: "hi-IN", mr: "mr-IN" };


type Vars = Record<string, string | number>;

function build(lang: Language) {
  const dictionary = dictionaries[lang];
  const t = (key: MessageKey, vars?: Vars) =>
    dictionary[key].replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? ""));
  // Enum values from the API (roles, stages, statuses) are translated through "v.<VALUE>".
  const label = (value: string) => {
    const key = "v." + value;
    return key in dictionary ? dictionary[key as MessageKey] : value.toLowerCase().replaceAll("_", " ");
  };
  const formatDate = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(locales[lang], { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(value)) + " IST"
      : "—";
  return { lang, t, label, formatDate };
}

interface I18n extends ReturnType<typeof build> {
  setLanguage: (next: Language) => void;
}

// The default value lets components render without a provider (tests, error boundaries).
const I18nContext = createContext<I18n>({ ...build("en"), setLanguage: () => {} });

export function I18nProvider({ initial, children }: { initial: Language; children: ReactNode }) {
  const [lang, setLang] = useState<Language>(initial);
  const setLanguage = useCallback((next: Language) => {
    document.cookie = `${LANGUAGE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = next;
    setLang(next);
  }, []);
  const value = useMemo(() => ({ ...build(lang), setLanguage }), [lang, setLanguage]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
