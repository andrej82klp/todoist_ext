# Todoist Gamification Companion App

Nuxt 4 full-stack companion app for Todoist. Todoist remains the source of truth for projects, tasks, and completion state; this app owns only gamification data such as metadata, rewards, points, streaks, and settings.

## Milestone 1 Status

The repository now includes:

- Nuxt 4 app scaffold using Nuxt UI
- Base application layout with dashboard, tasks, rewards, and settings navigation
- Placeholder pages for the MVP routes
- Server and shared directory skeleton for the modular monolith architecture
- Documented environment variables for future Todoist, session, and database work

## Milestone 2 Status

The repository now also includes:

- Drizzle ORM and migration tooling wired to `DATABASE_URL`
- Typed Postgres schema for users, Todoist mappings, metadata, settings, rewards, ledger, streaks, notifications, and webhook deliveries
- Repository helpers for users, settings defaults, rewards, and ledger records
- Seed and smoke-test scripts for the initial database slice

## Setup

Install dependencies:

```bash
pnpm install
```

Create a local environment file:

```bash
cp .env.example .env
```

Start the development server:

```bash
pnpm dev
```

Apply the database migration:

```bash
pnpm db:migrate
```

Seed a development user with default settings and milestone rows:

```bash
pnpm db:seed
```

Run checks:

```bash
pnpm lint
pnpm typecheck
pnpm db:smoke
```

## Environment Variables

The following variables are reserved for the next milestones:

- `DATABASE_URL`
- `TODOIST_CLIENT_ID`
- `TODOIST_CLIENT_SECRET`
- `TODOIST_REDIRECT_URI`
- `TODOIST_WEBHOOK_SECRET`
- `SESSION_SECRET`

`DATABASE_URL` should point to a Neon or local Postgres instance before running `pnpm db:migrate`, `pnpm db:seed`, or `pnpm db:smoke`.

See `.env.example` for placeholders and descriptions.

## Project Structure

```text
app/
  components/
  layouts/
  pages/

server/
  api/
  services/
  repositories/
  utils/
  middleware/
  db/

shared/
  types/
  constants/
  schemas/
```

## Current Scope

This first implementation slice does not yet include:

- database connectivity
- Todoist OAuth
- Todoist sync
- API business logic
- points or rewards logic

Milestone 2 adds the database foundation only. Todoist integration, session auth, scoring logic, and business APIs still land in later milestones.
