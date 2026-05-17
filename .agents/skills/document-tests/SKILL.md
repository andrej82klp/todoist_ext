# Documenting Tests — SKILL

Purpose
- Provide a repeatable, high-quality template and step-by-step workflow for adding explanatory documentation and comments to automated tests (unit, integration, end-to-end).
- Target audience: developers who read tests (frontend, backend, QA) and maintainers who edit or extend tests.

When to use
- You're adding or modifying tests and want them to be easily understandable by teammates.
- You want consistent, discoverable test documentation across the repo.
- You want test comments that explain intent, not implementation details.

Outcomes
- Test files contain clear, concise comments explaining the purpose of each test suite, each test case, and non-obvious setup/teardown or helper logic.
- A short header in each test file summarizing the feature under test, security considerations, and any DB/external dependencies.
- A checklist to follow before committing changes.

Principles
- Explain intent, not code. Comments should answer "why" a test exists and what it verifies, not restate the code line-by-line.
- Keep comments concise: 1–3 short sentences per block. Use inline comments for small clarifications and block comments for higher-level context.
- Prefer examples and expected outcomes when helpful (e.g., show the expected DB state or point totals in a calculation test).
- Mark external dependencies explicitly (e.g., requires DATABASE_URL, network access, environment secrets) and guard tests accordingly.
- Use TODO or FIXME tags sparingly for follow-ups; include a short justification.

Structure — what to add to each test file
1. File-level header (top of file)
   - One-line summary of the feature or endpoint being tested.
   - Short bullets: what the test file verifies (unit vs integration), and major external dependencies.

2. Helpers & utilities (above helper functions)
   - For each helper (e.g., `signPayload`, `sendRequest`): one short comment describing role, inputs, outputs, and any security assumptions.

3. Setup & teardown blocks (`beforeAll`, `afterAll`, `beforeEach`, `afterEach`)
   - Briefly state why this setup is needed (start server, seed DB, create users, ensure default settings).
   - If expensive or conditional, note how to skip or run locally.

4. Test suites (`describe`) and individual tests (`it` / `test`)
   - Before a `describe`, add a one-line statement: what the suite covers.
   - For each `it`:
     - Add a short comment explaining the behavior being asserted and its importance.
     - If the test exercises edge cases (idempotency, race conditions), explicitly call that out.

5. Key assertions and data checks
   - When assertions verify non-obvious invariants (e.g., ledger row counts, computed totals), add a short inline explanation showing how the expected value is computed.
   - Annotate DB queries that fetch test state with why that state is important to the assertion.

6. Cleanup notes
   - If the test creates DB rows or external state, show the cleanup plan (explicit deletion or test DB reset) and any rationale for leaving data in place (rare).

Example snippets
- File header
  // Tests for the X endpoint. Verifies authentication, input validation, and successful case.
  // Requires: DATABASE_URL pointing to a test DB. Skips integration tests when unset.

- Helper
  // signPayload(raw): compute HMAC signature using `TODOIST_CLIENT_SECRET`.

- Test intent
  // Unit: rejects invalid HMAC signatures to protect against forged webhooks.
  it('rejects invalid webhook signatures', ...)

- Points math inline for clarity
  // Each subtask: difficulty 2, medium priority -> 2 * 10 * 1.25 = 25 points
  expect(balance).toBe(56)

Checklist before commit
- [ ] Every test file has a one-line header describing its scope.
- [ ] Helpers and non-obvious logic are commented.
- [ ] Complex assertions include brief reasoning or calculation notes.
- [ ] External dependencies (DB, env secrets) are documented and guarded.
- [ ] Comments are concise and avoid repeating code.

Quality guidance
- Use present tense and active voice ("Verifies that...", "Creates a test user...").
- Keep comments up to date when refactoring tests — stale comments are worse than none.
- When a test is intentionally brittle or flaky, label it and explain why it remains enabled.

How to adopt this skill in CI or PR reviews
- Add a short PR checklist item: "Tests documented per `document-tests/SKILL.md`."
- During code review, verify that a reviewer unfamiliar with the feature can understand the test flow within 2–3 minutes using the comments.

Template to insert into a test file (copy/paste)
```js
// Summary: One-line summary of feature under test.
// Verifies: short bullet list of key behaviors.
// Requires: DATABASE_URL (integration), TODOIST_CLIENT_SECRET (signature tests)

// Helper: describe what this helper does and why.
function helper(...) { ... }

// Setup: why we start the server / seed DB
beforeAll(() => { ... })

// Suite: what this group of tests covers
describe('...', () => {
  // Unit: what this test asserts and why
  it('...', () => {
    // Explanation for non-obvious assertions
    expect(...).toBe(...)
  })
})
```

Next steps / iteration
1. Add the header & helper comments to a representative test file.
2. Review 1–2 additional test files and apply the same pattern.
3. If you want, I can create a small linter-like check (script) that verifies presence of file headers and common comment locations.

If anything is ambiguous, tell me which test patterns you use most (Vitest, Jest, Playwright, integration vs unit) and I will refine the templates accordingly.