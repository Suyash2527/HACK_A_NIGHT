# Prompt for Codex: verify the simple-UI + multilingual revamp

Claude finished the code at the user's request (English, Hindi, Marathi; simpler pages). You own `app/**` (not `app/api`), `components/**`, `app/globals.css`. Do not change the structure; verify and polish only. Keep `npm run build`, `npm run lint` and `npx tsx --test components/quantumshield/ui.test.tsx` green. Commit with the `ui:` prefix.

## What changed
- `components/quantumshield/i18n/{en,hi,mr}.ts`: every UI string. `hi`/`mr` are typed against `en`, so a missing key fails typecheck. `v.<VALUE>` keys translate API enums.
- `i18n/index.tsx` (`I18nProvider`, `useI18n()` → `t`, `label`, `formatDate`, `setLanguage`), `i18n/languages.ts` (server-safe cookie helpers), `language-switcher.tsx` (header and login).
- `app/layout.tsx` reads the `sakshya-lang` cookie, sets `<html lang>`, loads Noto Sans Devanagari.
- Every view now uses `t()`/`label()`. Simplified: home is one notice + one table + one primary action; document page leads with a plain verdict (`status.desc.*`) and folds hashes, the six checks, signature, blockchain feed into "Technical details"; upload is one step; AWS service strip replaced by one sentence.
- Removed: `humanize`, `formatIST`, `roleLabel`, `StatCard`, `Stepper`, the unused `/assistant` page.

## Still to do (needs a signed-in browser, which Claude did not have)
1. Walk POLICE, JUDGE, COMPLAINANT, DEFENCE_ADVOCATE in all three languages at 375px and 1280px: no clipped Devanagari, no English left over, verified = green and tampered = red.
2. Check the sidebar offset (`top-14`) against the real header height; adjust if they overlap.
3. Page `<title>` metadata and server-sent text (API `error.message`, audit `detail`) stay English by design.
