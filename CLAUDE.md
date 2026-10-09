# CLAUDE.md

@AGENTS.md

Spec: `docs/PROJECT_CONTEXT.md`. Verified prerequisite findings (exact APIs, versions, gotchas): `docs/PREREQS.md`.

Claude Code owns backend/crypto/data paths listed in AGENTS.md. Codex (GPT) is building the UI in the same working tree at the same time — check `docs/REQUESTS.md` for `[codex->claude]` requests before starting new work, and keep `types/api.ts` in sync with every route you add or change.
