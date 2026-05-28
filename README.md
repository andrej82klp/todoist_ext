# Todoist Gamification Companion App

A Nuxt 4 full-stack companion app for Todoist.

Todoist remains the source of truth for projects, tasks, and completion state. This app manages gamification-specific data and behavior, including metadata, points, rewards, streaks, analytics, and user settings.

## Features

- Nuxt 4 application with server API routes
- Postgres data layer with Drizzle ORM
- Shared TypeScript and Zod contracts across client and server
- Reward and ledger domain modeling
- Streaks and analytics support
- Session and auth-related server utilities

## Tech Stack

- Nuxt 4
- TypeScript
- Drizzle ORM + PostgreSQL
- Zod
- Vitest and Playwright

## Prerequisites

- Node.js 20+
- pnpm 10+
- PostgreSQL database (Neon or local)

## Setup

1. Install dependencies:

```bash
pnpm install
```

2. Create your local environment file:

```bash
cp .env.example .env
```

3. Configure required environment variables in `.env`:

- `DATABASE_URL`
- `TODOIST_CLIENT_ID`
- `TODOIST_CLIENT_SECRET`
- `TODOIST_REDIRECT_URI`
- `TODOIST_WEBHOOK_SECRET`
- `SESSION_SECRET`

4. Run database migrations:

```bash
pnpm db:migrate
```

5. Seed development data:

```bash
pnpm db:seed
```

## Running the Application

Start the app in development mode:

```bash
pnpm dev
```

Build for production:

```bash
pnpm build
```

Preview the production build locally:

```bash
pnpm preview
```

## Quality Checks

Run linting:

```bash
pnpm lint
```

Run type checks:

```bash
pnpm typecheck
```

Run database smoke tests:

```bash
pnpm db:smoke
```

Run end-to-end tests:

```bash
pnpm test:e2e
```

## Available Scripts

- `pnpm dev` - Start Nuxt in development mode
- `pnpm build` - Build production bundle
- `pnpm preview` - Preview production build
- `pnpm db:generate` - Generate Drizzle migrations
- `pnpm db:migrate` - Apply migrations
- `pnpm db:seed` - Seed development data
- `pnpm db:smoke` - Run DB smoke tests
- `pnpm lint` - Run ESLint
- `pnpm typecheck` - Run Nuxt type checks
- `pnpm test:e2e` - Run Playwright E2E tests

## Project Structure

```text
app/                  # Frontend pages, layouts, and components
server/               # API routes, services, repositories, and DB access
shared/               # Shared types, constants, and validation schemas
tests/                # Server, DB, and E2E tests
drizzle/              # SQL migrations and metadata snapshots
scripts/              # Utility scripts (for example, database seeding)
docs/                 # Product and architecture documentation
```

## Documentation

- See `docs/` for product, architecture, and API-related documents.
- See `server/README.md` for server-specific details.
