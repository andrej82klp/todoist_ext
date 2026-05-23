---
description: "Use when creating or editing Nuxt server API handlers in server/api. Enforces route patterns for defineApiHandler, auth/session checks, Zod schema validation, and consistent API response helpers."
applyTo: "server/api/**/*.ts"
---
# Server API Route Conventions

- Prefer wrapping handlers with `defineApiHandler` from `server/utils/api`.
- Prefer shared Zod schemas from `shared/schemas` with `parseBodyWithSchema` and `parseQueryWithSchema` from `server/utils/validation`; trivial endpoints may use lightweight parsing when justified.
- Keep cross-boundary types in `shared/types`; avoid route-local types when the type is reused by app/server boundaries.
- Use `requireCurrentUser` for authenticated routes before data access.
- Return API responses through helpers from `server/utils/api` (`success`, `collection`, and typed error helpers) instead of ad-hoc payload shapes.
- Keep handlers thin: place database access in repositories (`server/repositories`) and business logic in services (`server/services`).
- Add targeted rate limiting with `createRateLimiter` and `checkRateLimit` for mutation or webhook endpoints.
- Log operational events/errors through `server/utils/logger`; avoid logging secrets or raw sensitive payloads.
- Preserve minimal diffs and existing route structure; do not refactor unrelated handlers while implementing a request.
