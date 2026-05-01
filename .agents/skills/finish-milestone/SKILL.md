# Finish-Milestone Skill

Purpose
-------
This skill codifies a short, repeatable checklist agents use after finishing a milestone or feature in this repository. It ensures the app runs locally, basic QA passes, linting and tests are green, and any immediate issues are fixed before marking work done.

When to run
-----------
- After all items in the plan have been executed — run this skill as the final verification step before marking the milestone complete.

Step-by-step process
--------------------
1. Verify the development server on port `3000` is running.
   - If it is running, confirm it serves the app at `http://localhost:3000/`.
   - If not running, start the dev server with `pnpm dev` (avoid launching a duplicate instance).
2. Open `http://localhost:3000/` in the internal browser and perform smoke interactions.
  - Attempt to log in to Todoist using the stored credentials. For the purpose of this skill assume credentials are available and correct; do not prompt the user for them.
3. Run the linter: `pnpm lint`. Fix any reported issues.
4. Run tests (use the repository's preferred test script; see `package.json`).
   - Run unit and server smoke tests (e.g., `pnpm db:smoke` or `pnpm test`).
   - Fix failures or report blocking issues with reproduction steps.
5. Repeat the above steps until there are no runtime errors, lint failures, or test regressions.

Decision points and branching logic
----------------------------------
- Dev server already listening on port `3000`:
  - If it is the expected local instance, continue.
  - If it's an unexpected process, stop and investigate before proceeding.
- Login failures:
  - If credentials are known but login fails, capture the exact error and retry.
  - If 2FA or an interactive blocker is present, escalate to the human developer.
- Linter/test failures:
  - Non-blocking/style-only: fix automatically or document and proceed.
  - Blocking/runtime/test regressions: stop and fix before marking milestone complete.

Quality criteria / Completion checks
----------------------------------
- Perform a short suite of behavioral checks that exercise the feature surface and verify the application meets the task requirements. Examples:
  - Home page loads at `http://localhost:3000/` and shows the expected milestone content without console errors.
  - Navigate primary routes (e.g., `tasks`, `rewards`, `settings`) and confirm pages render without errors.
  - Authenticate via Todoist using the stored credentials (assume available) and confirm session resolution and logout work.
  - Verify key feature flows relevant to the completed work (for example: fetching/syncing tasks, creating or redeeming a reward, recording a ledger adjustment) behave as expected end-to-end.
  - Run the targeted tests and smoke tests for the changed area (e.g., `pnpm db:smoke`, unit tests) and ensure they pass.
  - Confirm no new uncaught exceptions appear in server logs or browser console during these flows.

- Only after all of the above behavioral checks and automated tests succeed should the milestone be marked complete.

Safety and operational notes
---------------------------
- Never run two dev servers for this project on different ports at the same time.
- Do not commit or echo real secrets in logs or repo files. Use environment variables or secret stores.

Example agent prompts
---------------------
- "Run the Finish-Milestone skill: check server, run linter, run tests, and report results." 
- "After feature X, run the finish-milestone checklist and fix any lint or test failures." 

Credentials (placeholder)
-------------------------
- Email: andrej.edge@outlook.com
- Password: ******** (masked placeholder — assume correct; do not request or log the real password)

Where to store credentials
-------------------------
- Store local verification credentials in `.secrets/todoist.env` (already ignored by git).
- File contents example:

  TODOIST_EMAIL=andrej.edge@outlook.com
  TODOIST_PASSWORD=********

- Agents and local scripts should load this file with `dotenv` and must never commit the real values.
