---
name: contract-test-runner
description: "Use when selecting, running, and debugging server contract/regression tests after API or service changes."
---

# Contract Test Runner

Purpose
- Provide a fast, repeatable flow for choosing the right server contract/regression tests and interpreting failures.

When to use
- You changed files in `server/api`, `server/services`, `server/repositories`, `shared/schemas`, or `shared/types`.
- You need confidence that response envelopes, auth behavior, and hardening regressions are still correct.

Primary commands
- Run repository smoke tests: `pnpm db:smoke`
- Run baseline contract tests: `vitest run tests/server/milestone-3-contracts.test.ts`
- Run baseline hardening tests: `vitest run tests/server/milestone-18-hardening.test.ts`

Feature-targeted examples
- Rewards: `vitest run tests/server/milestone-10-rewards.test.ts`
- Redemption: `vitest run tests/server/milestone-11-redemption.test.ts`
- Dashboard: `vitest run tests/server/milestone-12-dashboard.test.ts`
- Webhook: `vitest run tests/server/milestone-13-webhook.test.ts`
- Streaks: `vitest run tests/server/milestone-14-streaks.test.ts`
- Analytics: `vitest run tests/server/milestone-16-analytics.test.ts`

Selection workflow
1. Always run `milestone-3-contracts` and `milestone-18-hardening` for server behavior changes.
2. Add feature-specific milestone tests for the area you touched.
3. Run `pnpm build` when changes cross app/server boundaries.

Failure triage
1. Confirm route handlers use `defineApiHandler`, shared schema validation, and API response helpers.
2. Check for auth/session regressions (`requireCurrentUser`) on protected endpoints.
3. Re-run only the failing file while iterating, then re-run the full selected set.

Handoff checklist
- Commands run are listed in the final report.
- Any skipped test is explained.
- Known risks or untested edges are called out explicitly.
