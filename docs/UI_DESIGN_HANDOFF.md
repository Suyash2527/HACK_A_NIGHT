# Prompt for Codex: polish the Sakshya UI to award quality

You own `app/**` (not `app/api`), `components/**`, `app/globals.css`. The structure, i18n (English/Hindi/Marathi) and visual direction are in place; your job is craft and finish, not a new direction. Keep `npm run build`, `npm run lint` and `npx tsx --test components/quantumshield/ui.test.tsx` green. Small `ui:` commits.

## The direction (do not change it)
- **No brand colour.** White surfaces on `#f5f5f3` paper, graphite ink `#26231f`, soft ink `#5c5750`, lines `#e0deda`. Buttons are graphite. No blue, purple, teal, gradients, glows or coloured side panels. Tokens live at the top of `app/globals.css`.
- **Colour means status only:** green `#1d7a46` verified, red `#c0262d` tampered/denied, amber `#9a5800` pending. Never decorative.
- **Indian, but tiny:** the brass `#8a6516` seal with "स" in the wordmark, "साक्ष्य" beside "Sakshya", the brass bar on the active menu item, IST dates, and the rubber-stamp verdict on the document page (`.stamp`, `.verdict` in globals.css, `VerdictStamp` in `integrity-panel.tsx`). Do not add flags, chakras, the national emblem, tricolour stripes, rangoli or paisley.
- **Type:** Mukta (Ek Type, Indian foundry) for everything incl. Devanagari; IBM Plex Mono only for FIR numbers and fingerprints. Sentence case; no all-caps labels, no eyebrow text above headings.
- **One bold element:** the verdict stamp. Everything else stays quiet.

## Tasks
1. **Mobile tables (375px):** case and document tables scroll sideways today. Below 640px render each row as a stacked item (FIR number + status on one line, stage and date under it) inside `DataTable`, no horizontal scroll.
2. **Spacing rhythm:** use an 8px scale (8/16/24/32/48). Page title → content 24px; between panels 20–24px; panel padding 20px desktop / 16px mobile. Remove any leftover mixed values.
3. **Home pages per role:** check POLICE, FORENSIC_LAB, PUBLIC_PROSECUTOR, JUDGE, ADMIN, DEFENCE_ADVOCATE, COMPLAINANT each show one obvious primary action and nothing redundant. Complainant page: large readable sentence of current stage, then the timeline.
4. **States:** every empty, loading and error state says what to do next (keys exist in `components/quantumshield/i18n/en.ts`; add new keys to `hi.ts` and `mr.ts` too or typecheck fails).
5. **Verify the stamp** in all five states (VERIFIED green, TAMPERED red, PENDING_ANCHOR amber, UNANCHORED and ERROR) and in Hindi/Marathi (stamp text splits on " · ").
6. **Devanagari check:** at 375px and 1280px in hi and mr, no clipped matras, buttons don't overflow, line height ≥ 1.6.
7. **Accessibility:** 44px targets, visible focus (3px graphite outline), contrast ≥ 4.5:1 (the palette test in `ui.test.tsx` covers tokens), `prefers-reduced-motion` respected.
8. Remove anything decorative that does not carry information. Before each commit, screenshot the page and ask: does any part look like a generic AI dashboard (identical cards, icons on every heading, coloured blobs)? If yes, cut it.

Local review tip: run a second server with a throwaway DB so you don't touch `.data/db`:
`PGLITE_DIR=/tmp/pgl-review npx next start -p 3200` (after `npm run build`), sign in with the demo accounts.
