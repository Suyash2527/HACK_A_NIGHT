"use client";
import { Languages } from "lucide-react";
import { LANGUAGES, parseLanguage } from "./i18n/languages";
import { useI18n } from "./i18n";
import { en } from "./i18n/en";
import { hi } from "./i18n/hi";
import { mr } from "./i18n/mr";

// Each language is named in its own script so a reader can always find theirs.
const NATIVE_NAMES = { en: en["lang.name"], hi: hi["lang.name"], mr: mr["lang.name"] };

export function LanguageSwitcher() {
  const { lang, setLanguage, t } = useI18n();
  return (
    <label className="no-print inline-flex items-center gap-1.5 text-sm">
      <Languages className="size-4 opacity-70" aria-hidden="true" />
      <span className="sr-only">{t("lang.label")}</span>
      <select
        value={lang}
        onChange={e => setLanguage(parseLanguage(e.target.value))}
        className="border px-2 py-1 text-sm"
        aria-label={t("lang.label")}
      >
        {LANGUAGES.map(code => <option key={code} value={code} lang={code}>{NATIVE_NAMES[code]}</option>)}
      </select>
    </label>
  );
}
