---
description: "Use when editing DB schema, migrations, repositories, or DB scripts. Enforces safe database workflows, deterministic migrations, and test-environment protections."
applyTo: "{drizzle/**/*.sql,server/db/**/*.ts,server/repositories/**/*.ts,scripts/db-*.ts,tests/db/**/*.ts,drizzle.config.ts}"
---
# Database Safety Rules

- Assume all DB actions must be safe for local/dev/test only unless the user explicitly requests otherwise.

## Environment Guardrails

- Ensure `DATABASE_URL` points to a disposable dev/test database before running DB commands.
- Never run migrations or seeds against production data.
- Never print secrets or full connection strings in logs.

## Migration And Schema Changes

- Keep migration changes deterministic and minimal.
- Prefer additive, reversible schema changes when possible.
- Keep `drizzle/` migration files and DB schema updates aligned in the same task.

## Validation Before Handoff

1. Run `pnpm db:smoke` after DB/repository changes.
2. Run targeted server tests if API behavior depends on the DB change.
3. Report what was executed and any known residual risk.

## Scope Discipline

- Do not introduce unrelated migration churn or schema refactors.
- If a DB command is risky or ambiguous, pause and ask before proceeding.
