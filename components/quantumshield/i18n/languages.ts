// Plain module (no "use client") so the root layout can read the language cookie on the server.
export const LANGUAGES = ["en", "hi", "mr"] as const;
export type Language = (typeof LANGUAGES)[number];
export const LANGUAGE_COOKIE = "sakshya-lang";

export function parseLanguage(value: string | undefined): Language {
  return LANGUAGES.find(code => code === value) ?? "en";
}
