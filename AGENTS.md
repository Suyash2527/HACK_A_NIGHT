# AGENTS.md — rules for every AI agent in this repo (Codex reads this automatically)

Full problem statement and spec: `docs/PROJECT_CONTEXT.md`. Read it before doing anything.
Code freeze: **Sat 10 Oct 2026, 12:00 IST**. A working, deployed demo beats unfinished ambition.

## Two agents, one working tree — folder ownership is the law

| Owner | Paths |
|---|---|
| **Claude Code** (backend, crypto, data, AWS infra) | `lib/**`, `app/api/**`, `db/**` (SQL migrations, seed), `infra/**` (AWS setup/deploy scripts), `contracts/**`, `scripts/**`, `types/api.ts`, `next.config.*`, `middleware.ts`/`proxy.ts`, `.env.example` |
| **Codex** (UI, product, pitch) | `app/**` pages and layouts **except** `app/api/**`, `components/**`, `app/globals.css`, theme, `public/**`, `docs/UI_SPEC.md`, `docs/DEMO_SCRIPT.md`, `docs/PITCH.md`, README screenshots section |
| **Human** (integrator) | merges decisions, runs dev server, deploys, demo |

- Never edit files you do not own. If you need a change in the other side's files, write the request in `docs/REQUESTS.md` (append, one line, prefixed `[codex->claude]` or `[claude->codex]`).
- `types/api.ts` is the **API contract** (request/response types for every `app/api` route). Claude Code writes it; Codex imports from it and must not redefine those shapes. Until an endpoint is live, Codex uses mock data that conforms to these types (`components/**/mocks.ts`).
- `package.json` / lockfile: install packages one agent at a time and commit the lockfile immediately in its own commit. Use **npm** only (no pnpm/yarn).
- Commit only your own paths (`git add <your paths>`), small and often, message prefix `ui:` (Codex) or `core:` (Claude). Never `git add -A`, never force-push, never rewrite history.

## Non-negotiables (from the spec)
- No plaintext at rest. No secrets in code — only `process.env.*`, documented in `.env.example`.
- Documents and audit log are append-only. No edit/delete UI anywhere. Corrections = new version.
- Verified = green, tampered/denied = red. Every verification state must be visible in the UI.
- Stack is **full AWS** (RDS Postgres + RLS, Cognito, S3, KMS, Bedrock). No Supabase/Vercel/Gemini code or packages.
- AWS SDK, DB access and secrets are server-only (`app/api/**`, `lib/**`). Never import them in client components.

## Commands
- `npm run dev` — dev server (human runs it; don't start a second one)
- `npm run build` — must pass before any commit that touches routing or config
- `npm run lint`

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
