---
name: contract-test-runner
description: "Use when selecting, running, and debugging server contract/regression tests after API or service changes."
---

# Contract Test Runner

Purpose
- Provide one accurate workflow for selecting, running, and debugging server contract and regression tests.
- Keep the skill aligned with the repo's real API helpers, test files, and validation commands.

When to use
- You changed `server/api`, `server/utils/api.ts`, `server/utils/validation.ts`, `server/services`, `server/repositories`, `shared/schemas`, `shared/types/api.ts`, or `shared/constants/api.ts`.
- You need confidence that API envelopes, validation behavior, auth handling, and hardening behavior still match the shared contract.

What the contract tests cover
- `tests/server/milestone-3-contracts.test.ts` is the baseline API contract suite.
- It verifies the shared response envelopes returned by `success`, `collection`, and `action` from `server/utils/api.ts`.
- It verifies validation failures normalize to `422` with `error.code = 'VALIDATION_ERROR'` and field-level details under `error.details.fields`.
- It verifies shared API error helpers normalize the documented status codes for `400`, `401`, `403`, `404`, and `409`.
- These tests spin up an in-memory H3 server against the internal handlers under `server/api/internal/test-contract`.

Core commands
- Baseline contract suite: `vitest run tests/server/milestone-3-contracts.test.ts`
- Baseline hardening suite: `vitest run tests/server/milestone-18-hardening.test.ts`
- Feature suites as needed: `vitest run tests/server/milestone-10-rewards.test.ts`, `tests/server/milestone-11-redemption.test.ts`, `tests/server/milestone-12-dashboard.test.ts`, `tests/server/milestone-13-webhook.test.ts`, `tests/server/milestone-14-streaks.test.ts`, `tests/server/milestone-16-analytics.test.ts`
- Cross-app/server validation when interfaces moved: `pnpm typecheck`
- Full production build when routing or app/server integration changed materially: `pnpm build`

Important command note
- `pnpm db:smoke` runs `tests/db/repositories.smoke.test.ts`. It is useful for repository coverage, but it is not the API contract test command in this repo.

Selection workflow
1. If the change touches shared API helpers, route envelopes, validation, or request parsing, run `tests/server/milestone-3-contracts.test.ts` first.
2. If the change affects auth, permissions, throttling, or defensive behavior, also run `tests/server/milestone-18-hardening.test.ts`.
3. Add the closest feature milestone test for the area you changed.
4. Run `pnpm typecheck` for shared contract or cross-boundary type changes.
5. Run `pnpm build` only when the touched slice crosses app and server behavior enough that typecheck alone is not sufficient.

Route expectations to check during triage
- Route handlers should be wrapped with `defineApiHandler` from `server/utils/api.ts`.
- Protected routes should call `requireCurrentUser` before accessing user-scoped data.
- Request parsing should usually use `parseBodyWithSchema` or `parseQueryWithSchema` from `server/utils/validation.ts` with shared Zod schemas.
- Success responses should use `success(data)`, `collection(data, meta)`, or `action(isSuccessful, message)` instead of ad hoc payloads.
- Error paths should throw typed helpers such as `badRequestError`, `unauthorizedError`, `forbiddenError`, `notFoundError`, `conflictError`, `validationError`, `tooManyRequestsError`, or `internalServerError`.

Debugging workflow
1. Run the smallest failing suite directly with `vitest run <file>`.
2. Compare the failure against the real contract sources: `server/utils/api.ts`, `shared/types/api.ts`, `shared/constants/api.ts`, and `tests/server/milestone-3-contracts.test.ts`.
3. Verify the route is not returning bare data, custom error objects, or manually shaped validation payloads.
4. Re-run the same narrow suite after each fix.
5. Re-run the full selected set before handoff.

Common mistakes
- Treating `pnpm db:smoke` as the contract suite.
- Returning bare objects instead of `success`, `collection`, or `action` envelopes.
- Throwing generic `Error` values where a typed API helper should be used.
- Describing collection metadata or action payloads differently from `shared/types/api.ts`.
- Forgetting that validation details are field-based and normalized through Zod parsing and `defineApiHandler`.

Handoff checklist
- List the exact validation commands you ran.
- Explain any skipped suite.
- Call out any remaining risk if only a subset of feature suites was executed.
