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
| `/` | Dashboard | Stats, top value bets, Line Movements widget, sport/bookmaker breakdown |
| `/value-bets` | Value Bets | Filterable/sortable table of live-market edge bets (≥0.5% edge) |
| `/games` | Games | Game cards (live/upcoming/final) across all sports |
| `/games/:id` | Game Detail | Odds comparison, model prediction, moneyline history chart, injury report |
| `/tracker` | Bet Tracker | Log bets, mark W/L, ROI/bankroll chart |
| `/settings` | Settings | Theme, push alerts, preferences, disclaimer |

## Data Flow

Real odds data from **The Odds API** (`ODDS_API_KEY` secret required):
- Sports: `americanfootball_nfl`, `basketball_nba`, `baseball_mlb`, `icehockey_nhl`
- Bookmakers: DraftKings, FanDuel, BetMGM, Caesars, PointsBet, etc.
- Odds cached for 5 minutes in-memory (TTL cache in `lib/odds-api.ts`)
- Edge = consensus de-vig probability − book-offered implied probability
- Min edge threshold: 0.5% (real US markets are efficient)
- Kelly sizing: quarter-Kelly, capped at 10% bankroll

## Line Movement Tracking

Snapshot job in `artifacts/api-server/src/lib/snapshot-job.ts`:
- Runs every **5 minutes** on startup
- Stores all bookmaker prices in `odds_snapshots` PostgreSQL table
- Route `GET /api/line-movements` — detects price changes across snapshots (min 0.1% move)
- Route `GET /api/line-movements/:gameId` — returns full price history for a game
- Dashboard shows "Line Movements" widget (last 3h)
- Game Detail shows "Moneyline History" chart (Recharts LineChart, implied win %)
- Snapshots older than 48h are automatically pruned

## DB Schema

| Table | Purpose |
|---|---|
| `sessions` | Auth sessions |
| `bets` | User bet tracker entries |
| `alert_subscriptions` | Push notification subscriptions |
| `odds_snapshots` | Historical odds prices (5-min snapshots) |

## Design

- Dark terminal aesthetic: primary green `hsl(142 71% 45%)`, background `hsl(222 25% 7%)`
- Edge badges: ≥2% green, ≥1% amber, <1% muted (real markets)
- Monospace font for numbers/odds throughout
- Mobile-responsive with sidebar (desktop) + bottom nav (mobile)
- Auto-refresh every 60s on Dashboard and Value Bets pages

## Notes / Gotchas

- **Zod in api-server**: Import from `"zod"`, never `"zod/v4"` — esbuild cannot resolve the subpath.
- **Orval codegen**: After changing the OpenAPI spec, run `pnpm --filter @workspace/api-spec run codegen`. The post-codegen script patches `lib/api-zod/src/index.ts`.
- **Port**: api-server runs on port 8080; edge-finder runs on port 23705. The shared proxy routes `/api` → 8080 and `/` → 23705.
- **Edge thresholds**: Updated to ≥2% green, ≥1% amber (was 5%/3%) to reflect real efficient US market conditions.
- **Line movements**: First snapshot taken on server start. Cross-book spread shown as fallback before historical data accumulates (5+ minutes runtime needed for time-based movement detection).
