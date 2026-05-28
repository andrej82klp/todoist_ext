# Running & Validating Contract Tests — SKILL

Purpose
- Provide a quick reference for running, understanding, and validating API contract tests locally.
- Contract tests verify that API responses conform to expected structure (success, collection, action envelopes) and error normalization.
- Target audience: developers who modify API routes and need to ensure responses meet contract obligations.

When to use
- You are creating or modifying API routes in `server/api/**/*.ts`.
- You need to verify your responses follow the standard envelope structure.
- You want to check error messages are normalized consistently.
- You're validating that validation errors are properly formatted and returned.
- You need confidence that your API changes don't break client expectations.

Outcomes
- You can run contract tests locally in under 30 seconds.
- You understand what contract tests verify (envelopes, validation, error shapes).
- You know how to debug a failed contract test and fix the route.
- Your API changes are validated against the shared contract before commit.

Principles
- Contract tests are fast integration tests that spin up a local H3 server in-memory.
- They test response shape and error normalization, not business logic (that belongs in unit/service tests).
- A contract test failure means your API response doesn't match what clients expect.
- Run contract tests early and often during development; they catch response structure bugs before PR review.

How to run contract tests locally

Run all contract tests
```bash
pnpm db:smoke
```
This runs the main contract test file (`tests/server/milestone-3-contracts.test.ts`), which verifies:
- Single-resource success envelope
- Collection envelope with array of items and `meta`
- Action envelope for mutations
- Validation error formatting with field-level details
- Shared error normalization helpers for 400, 401, 403, 404, and 409 responses

Run a specific test or suite
```bash
# Run only a specific test suite
vitest run tests/server/milestone-3-contracts.test.ts -t "single-resource"

# Run tests matching a pattern
vitest run tests/server/milestone-3-contracts.test.ts -t "error"

# Watch mode: re-run on file changes
vitest tests/server/milestone-3-contracts.test.ts --watch
```

Understanding contract test structure

Each contract test file checks:
1. **Success envelope**: Single resource returned with `{ data: {...} }`
2. **Collection envelope**: Multiple resources as `{ data: [...], meta: { page, pageSize, total } }`
3. **Action envelope**: Mutations (create/update/delete) return `{ data: { success: true, message: '...' } }`
4. **Validation errors**: Invalid input returns `{ error: { code: 'VALIDATION_ERROR', message: '...', details: { fields: ... } } }`
5. **HTTP status codes**: Validation errors return 422, while normalized API errors include 400 (bad request), 401 (unauthorized), 403 (forbidden), 404 (not found), 409 (conflict), and 500 (internal server error)

Common contract patterns

Single resource (GET):
```typescript
// Contract test expects:
const response = await fetch('/api/tasks/123')
expect(response.json()).toEqual({
  data: { id: 123, title: '...' }
})
```

Collection (GET list):
```typescript
// Contract test expects:
const response = await fetch('/api/tasks')
expect(response.json()).toEqual({
  data: [...],
  meta: { page: 1, pageSize: 20, total: 42 }
})
```

Action (POST/PUT/DELETE):
```typescript
// Contract test expects:
const response = await fetch('/api/tasks', { method: 'POST', body: '...' })
expect(response.json()).toEqual({
  data: { success: true, message: 'Task created' }
})
```

Validation error:
```typescript
// Invalid input returns:
{
  error: {
    code: 'VALIDATION_ERROR',
    message: 'Invalid request payload',
    details: {
      fields: {
        title: ['Required']
      }
    }
  }
}
```

How to validate your API route

1. **Check response helpers in your route**
   Open your route file `server/api/...` and verify it uses response helpers from `server/utils/api.ts`:
   - `success(data)` — wraps a single resource in the shared success envelope
   - `collection(data, meta)` — wraps list responses with pagination metadata
   - `action(isSuccessful, message)` — wraps mutation responses with a success flag and message
   - `badRequestError(message)` — returns 400 with error envelope
   - `unauthorizedError(message)` — returns 401
   - `forbiddenError(message)` — returns 403
   - `notFoundError(message)` — returns 404
   - `conflictError(message)` — returns 409
   - `validationError(details)` — returns 422 with field-level validation details

   Example route:
   ```typescript
   export default defineApiHandler(async (event) => {
     const user = await requireCurrentUser(event)
     const body = await readValidatedBody(event, TaskCreateSchema)
     const task = await createTask(user.id, body)
     return success(task)
   })
   ```

2. **Run the tests to validate**
   ```bash
   pnpm db:smoke
   ```

3. **If tests fail**
  - Check if you're using `success()`, `collection()`, or `action()` instead of returning ad hoc response shapes
   - Verify error throwing uses standard helpers (e.g., `throw badRequestError('...')` not `throw new Error('...')`)
   - Ensure request validation uses Zod schemas from `shared/schemas/`
  - Check HTTP status code matches error type (422 for `validationError`, 400 for `badRequestError`, etc.)

4. **Common mistakes to avoid**
  - ❌ Returning bare data: `return { id: 1, title: '...' }` → use `success()` instead
   - ❌ Throwing custom Error: `throw new Error('Bad input')` → use `badRequestError()` instead
   - ❌ Validating without Zod: manual if/checks → use `readValidatedBody()` with schema instead
  - ❌ Returning list responses without `meta` → use `collection()` instead
  - ❌ Returning validation errors as status 400 or 500 → use `validationError()` so they normalize to 422 with field details

Debugging a failed contract test

When `pnpm db:smoke` fails:
1. **Read the error message** — it will show which contract was violated (for example, missing `meta`, the wrong error `code`, or a mismatched envelope shape)
2. **Check your route** — find the API route you modified and verify it uses response helpers
3. **Run in watch mode** to iterate quickly:
   ```bash
   vitest tests/server/milestone-3-contracts.test.ts --watch
   ```
4. **Fix the route** and the test will re-run automatically
5. **Verify all contract tests pass** before pushing:
   ```bash
   pnpm db:smoke
   ```

Checklist before commit
- [ ] All contract tests pass: `pnpm db:smoke`
- [ ] Your route uses `success()`, `collection()`, or `action()` for responses, not bare data
- [ ] Error throwing uses standard helpers (`badRequestError`, `unauthorizedError`, etc.), not `throw new Error`
- [ ] Request validation uses Zod schemas and `readValidatedBody()`
- [ ] HTTP status codes match error types, including 422 for `validationError()`

Integration with other tests
- **Contract tests** (this skill): verify response structure and error normalization — fast, run first
- **Service/domain tests**: verify business logic (points calculation, task filtering, etc.) — run after contracts pass
- **E2E tests** (`pnpm test:e2e`): verify full user flows — run before merge

When to skip or extend
- If adding a new error type, add a test case in `milestone-3-contracts.test.ts` to verify it's normalized correctly
- If creating a major new endpoint category, consider adding a new contract test file in `tests/server/`
- Contract tests should not need secrets or external APIs — if they do, set up mocks or use test fixtures

Next steps
1. Run `pnpm db:smoke` to verify all contract tests pass in your current repo state
2. Modify an API route and re-run tests to see live feedback
3. Reference `server/utils/api.ts` for all available response helpers and error constructors
4. If adding a new error scenario, add a test case to `tests/server/milestone-3-contracts.test.ts`
