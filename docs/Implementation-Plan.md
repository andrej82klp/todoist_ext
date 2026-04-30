# Implementation Plan — Todoist Extension

This document lists the project milestones and minimal acceptance criteria. Each milestone is represented as a checklist item and has a matching tracked todo entry (IDs in the session todo list).

How to use:
- To flag a milestone complete: update the checklist mark `[ ]` → `[x]` in this file, and/or update the session todo list via the agent that manages it.
- This file is intended to be machine-readable for an onboarding agent; keep the checklist lines intact.

## Milestones

1. [ ] Milestone 1 — Project scaffolding & config  (todo id: 1)
   - Acceptance: `pnpm dev` starts, TypeScript checks pass, environment and README updated.

2. [ ] Milestone 2 — Database schema & migrations  (todo id: 2)
   - Acceptance: Drizzle schema committed, migrations run locally, sample data seeded.

3. [ ] Milestone 3 — Core API endpoints & session auth  (todo id: 3)
   - Acceptance: `/api/auth/session` and `/api/auth/logout` work; session cookie created and validated by middleware.

4. [ ] Milestone 4 — Frontend integration & UI flows  (todo id: 4)
   - Acceptance: Connect UI navigation works, client routes protected, basic UX for login/logout present.

5. [x] Milestone 5 — OAuth Todoist integration (implemented)  (todo id: 5)
   - Acceptance: `/api/auth/todoist/start` and `/api/auth/todoist/callback` implemented, tokens persisted in `oauth_accounts`, app session created on success.
   - Notes: If the live OAuth callback needs re-validation, run the dev server and perform the Todoist login flow; check server logs for errors.

## Next Actions (recommended for a new agent)
- Re-run the test suite: `pnpm vitest run` then `pnpm tsc --noEmit`.
- If any milestone needs revalidation, run the associated acceptance checks above and toggle the checklist and todo status accordingly.

## Metadata
- Generated: 2026-04-30
- Path: `/docs/Implementation-Plan.md`
