# EdgeFinder — Workspace

## Overview

Full-stack sports betting value finder. React+Vite frontend, Express 5 API backend, PostgreSQL+Drizzle ORM, Replit Auth (OIDC/PKCE).

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (api-server uses plain `"zod"`, NOT `"zod/v4"` — esbuild cannot resolve the subpath)
- **API codegen**: Orval (from OpenAPI spec in `lib/api-spec`)
- **Build**: esbuild (for api-server)
- **Frontend**: React + Vite + TailwindCSS v4 + shadcn/ui

## Packages

| Package | Purpose |
|---|---|
| `artifacts/edge-finder` | React+Vite frontend (all UI pages) |
| `artifacts/api-server` | Express 5 REST API (routes + auth + DB) |
| `lib/api-spec` | OpenAPI spec + Orval codegen |
| `lib/api-client-react` | Generated React Query hooks (from Orval) |
| `lib/api-zod` | Generated Zod schemas (from Orval) |
| `lib/db` | Drizzle ORM schema + migrations |
| `lib/replit-auth-web` | Frontend auth hook (`useAuth`) |

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Architecture

- All API routes live under `/api` (Express router at `artifacts/api-server/src/routes/`)
- Auth: Replit OIDC with PKCE. Session stored in PostgreSQL `sessions` table. Cookie: `sid`.
- `authMiddleware.ts` attaches `req.user: AuthUserData` and `req.isAuthenticated()` to every request.
- Frontend uses `useAuth()` from `@workspace/replit-auth-web`. Unauthenticated users are auto-redirected to `/api/login`.

## Frontend Pages

| Route | Page | Description |
|---|---|---|
| `/` | Dashboard | Stats overview, top value bets, sport/bookmaker breakdown |
| `/value-bets` | Value Bets | Filterable/sortable table of 3%+ edge bets |
| `/games` | Games | Game cards (live/upcoming/final) across all sports |
| `/games/:id` | Game Detail | Odds comparison, model prediction, injury report |
| `/tracker` | Bet Tracker | Log bets, mark W/L, ROI/bankroll chart |
| `/settings` | Settings | Theme, push alerts, preferences, API key, disclaimer |

## Data

Currently uses **mock data** in all route handlers. To switch to real odds:
1. Add `ODDS_API_KEY` secret (Settings page has the API key input)
2. Update `artifacts/api-server/src/routes/odds.ts` to call `https://api.the-odds-api.com/v4/sports/...`

## Design

- Dark terminal aesthetic: primary green `hsl(142 71% 45%)`, background `hsl(222 25% 7%)`
- Edge badges: ≥5% green, 3-4.9% amber, <3% muted
- Monospace font for numbers/odds throughout
- Mobile-responsive with sidebar (desktop) + bottom nav (mobile)
- Auto-refresh every 60s on Dashboard and Value Bets pages

## Notes / Gotchas

- **Zod in api-server**: Import from `"zod"`, never `"zod/v4"` — esbuild cannot resolve the subpath.
- **Orval codegen**: After changing the OpenAPI spec, run `pnpm --filter @workspace/api-spec run codegen`. The post-codegen script patches `lib/api-zod/src/index.ts`.
- **Port**: api-server runs on port 8080; edge-finder runs on port 23705. The shared proxy routes `/api` → 8080 and `/` → 23705.
