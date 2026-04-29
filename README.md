# Todoist Gamification Companion App

Nuxt 4 full-stack companion app for Todoist. Todoist remains the source of truth for projects, tasks, and completion state; this app owns only gamification data such as metadata, rewards, points, streaks, and settings.

## Milestone 1 Status

The repository now includes:

- Nuxt 4 app scaffold using Nuxt UI
- Base application layout with dashboard, tasks, rewards, and settings navigation
- Placeholder pages for the MVP routes
- Server and shared directory skeleton for the modular monolith architecture
- Documented environment variables for future Todoist, session, and database work

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

Run checks:

```bash
pnpm lint
pnpm typecheck
```

## Environment Variables

The following variables are reserved for the next milestones:

- `DATABASE_URL`
- `TODOIST_CLIENT_ID`
- `TODOIST_CLIENT_SECRET`
- `TODOIST_REDIRECT_URI`
- `TODOIST_WEBHOOK_SECRET`
- `SESSION_SECRET`

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

Those land in the next milestones after the scaffold is validated.
