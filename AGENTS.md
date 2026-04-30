# AGENTS — Guidance for AI coding agents

This file gives concise, actionable instructions to help an AI coding agent be immediately productive in this repository.

Principles
- Link, don't embed: reference docs in `docs/` and top-level README.md instead of duplicating.
- Minimal, actionable: include only what an agent cannot easily discover.
- Preserve style and scope: make small, surgical changes; don't refactor unrelated code.

Quick repo facts
- Scripts: use `pnpm` (see `package.json`): `pnpm dev`, `pnpm build`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm db:smoke`, `pnpm lint`, `pnpm typecheck`.
- Framework: Nuxt 4 full-stack app with server routes under `server/api` and shared DTOs under `shared/`.
- Database: Drizzle ORM + Postgres. Migration/seed commands are in `package.json` and `drizzle/` contains SQL snapshots.
- Tests: Vitest-based smoke/contract tests live under `tests/` (e.g. `tests/server`, `tests/db`). Use `pnpm db:smoke` or run specific test files with `vitest`.

Key places to look
- App/UI: `app/` (pages, layouts, components).
- Server routes and handlers: `server/api/` (grouped by feature), middleware in `server/middleware`.
- DB layer: `server/db/` and `drizzle/` for migrations and schema.
- Services & repos: `server/services/` and `server/repositories/` for business logic.
- Shared types and schemas: `shared/` (types, schemas, constants).
- Docs: `docs/` for design, API spec, and plans.

Common tasks and where to start
- Implement an API route: follow patterns in `server/api/*/*.ts` and reference `shared/schemas` for request/response contracts.
- Add a DB migration: update `drizzle/` SQL or use `drizzle-kit` commands; keep tests deterministic.
- Add tests: place server tests under `tests/server` and use existing contract tests as examples.

Environment and safety
- Don't run migrations or seeds against a production DB; `DATABASE_URL` must point to a test/dev DB for `pnpm db:migrate` and `pnpm db:seed`.
- Secrets: do not print or commit real secrets. See `.env.example` and `server/utils/secrets.ts` for handling.

Coding conventions
- Use TypeScript `type`/`interface` definitions under `shared/types` for cross-boundary data.
- Use Zod schemas from `shared/schemas` for request validation; server routes generally accept validated payloads.
- Keep server-side helpers in `server/utils` and services in `server/services`.

Developer workflow for agents
1. Run `pnpm install` (if needed) and verify `pnpm dev` starts locally.
2. Run linters: `pnpm lint`; run typecheck: `pnpm typecheck`.
3. Run specific tests: `pnpm db:smoke` or `vitest tests/server/<file>.test.ts`.
4. When editing files, make minimal diffs and add/adjust tests to cover behavior.

When to ask the human
- Ambiguous requirements that affect public APIs or DB schema.
- Permission to modify migrations or seed data that impact other developers.

Useful links
- Repo README: [README.md](README.md)
- Server README: [server/README.md](server/README.md)
- Docs directory: [docs/](docs/)

Proposals for additional agent customizations
- Create a CI-focused instruction that documents expected pipeline steps and test targets.
- Add a small `agent-skill` describing how to run and validate contract tests locally.

If you want, I can update or expand this into `.github/copilot-instructions.md` or split per area (frontend/backend/tests).
