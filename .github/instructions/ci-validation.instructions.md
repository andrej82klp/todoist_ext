---
description: "Use when implementing code changes that should pass local CI-equivalent checks before handoff. Defines the default validation sequence and reporting expectations for this repository."
applyTo: "{app,server,shared,tests,scripts}/**/*.{ts,tsx,js,mjs,cjs,vue}"
---
# Local CI Validation

- Run validations in a CI-like order whenever code behavior changes.

## Default Sequence

1. `pnpm lint`
2. `pnpm typecheck`
3. `pnpm db:smoke` for DB, repository, service, or server route changes.
4. Targeted server tests under `tests/server/` for changed behavior (for example `vitest run tests/server/milestone-18-hardening.test.ts`).
5. `pnpm build` for shared/config/cross-cutting changes.
6. `pnpm test:e2e` for route-level UI flows when Playwright setup is available.

## Reporting Rules

- Report exactly which checks were run.
- If a relevant check is skipped, state why.
- Keep fixes scoped to the current task; do not refactor unrelated code to satisfy validation.

## Safety Rules

- Do not run `pnpm db:migrate` or `pnpm db:seed` unless the task explicitly requires schema/data changes.
- Treat failing checks as blocking unless the user explicitly accepts a known failure.
