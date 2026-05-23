---
description: "Use when creating or editing CI workflows and related validation scripts. Documents the expected pipeline sequence, test targets, and safety checks for this repository."
applyTo: ".github/workflows/**/*.yml"
---
# CI Pipeline Expectations

- Keep CI steps deterministic and fast; preserve this baseline sequence unless a change explicitly requires otherwise.

## Expected Pipeline Order

1. Install dependencies with `pnpm install --frozen-lockfile`.
2. Run static checks:
   - `pnpm lint`
   - `pnpm typecheck`
3. Run database smoke tests:
   - `pnpm db:smoke`
4. Run targeted server contract/regression tests when server behavior changes:
   - `vitest run tests/server/milestone-3-contracts.test.ts`
   - `vitest run tests/server/milestone-18-hardening.test.ts`
   - Add feature-specific milestone tests as needed (for example `tests/server/milestone-14-streaks.test.ts`).
5. Run production build validation:
   - `pnpm build`
6. Run E2E tests only in jobs that provide required browser/runtime setup:
   - `pnpm test:e2e`

## Test Target Guidance

- DB/repository changes: always include `pnpm db:smoke`.
- API or service changes: run relevant tests under `tests/server/` in addition to static checks.
- UI changes with workflow impact: run `pnpm test:e2e` when Playwright prerequisites are available.
- Broad cross-cutting changes: run all of the above plus `pnpm build`.

## Safety And Environment Rules

- Never run migrations or seeds against production data in CI.
- Ensure `DATABASE_URL` points to a disposable test/dev database for DB test jobs.
- Do not print secrets in logs; rely on masked CI secrets.
- Keep workflow changes minimal and avoid unrelated refactors in the same PR.
