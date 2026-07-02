# Political Arena

A fair, structured environment for political candidates to campaign, challenge each other, and answer to voters — with accountability built into the platform itself.

**Stack:** Cloudflare Workers · D1 (SQLite) · R2 · React 19 · Vite · Tailwind v4 · Zustand · itty-router · Zod · jose

## What it does

- **Races & candidates** — federal/state/local races with verified candidate profiles.
- **Ad flights** — candidate ads move through a moderated pipeline (`draft → submitted → in_review → approved → active → completed`), each with a mandatory "Paid for by" disclaimer.
- **Rebuttals** — when an ad goes live, opposing candidates in the same race get a reserved rebuttal window (default 48h, max 3 rebuttal slots per ad). Ads and their rebuttals are served as paired units.
- **Challenges (accountability core)** — candidates formally challenge opponents (debate request, fact check, policy question). Challenges carry a business-day response deadline; non-response is *publicly visible* as `expired`. Targets may respond, refuse (with a stated reason), or the challenger may withdraw. State machine: `open → responded | refused | expired | withdrawn`.
- **Credits** — each challenge costs 1 credit (atomic deduction, ledgered in `credit_transactions`, refunded on withdrawal). Admins grant credits; every grant is audit-logged.
- **What Matters** — voters rank their top-5 issues; aggregates and cross-party overlap surface what the electorate actually cares about.
- **Questions** — voter and credentialed-press questions per race, with dedup-safe upvoting.
- **Press credentials** — journalists apply with outlet proof; admins/moderators review.
- **Notifications** — subscribe to races/candidates; in-app notifications on challenge activity.
- **Audit log** — append-only record of every state-changing action (who, what, before/after, hashed IP).

## Architecture

```
Browser (React SPA)
   │  /api/*  (axios, Bearer JWT)
   ▼
Cloudflare Worker (src/worker.js)
   ├─ 15 route modules (src/routes/*.routes.js, itty-router)
   ├─ auth.js        PBKDF2 password hashing + encrypted JWT (A256GCM) + session binding
   ├─ middleware.js  auth guards, role checks, CORS allowlist, pagination
   ├─ validation.js  Zod schemas for every write endpoint
   ├─ ratelimit.js   D1-backed fixed-window rate limiter (atomic UPSERT)
   ├─ audit.js       non-blocking append-only audit log (ctx.waitUntil)
   └─ db.js          30 tables + 48 indexes, CREATE IF NOT EXISTS bootstrap
   │
   ├─ D1  (ARENA_DB)     all relational state
   ├─ R2  (ARENA_MEDIA)  candidate media (video/image/audio), served via /media/*
   └─ Cron (*/15 min)    challenge expiry, ad lifecycle, session/analytics cleanup
```

The Vite-built SPA is served from Workers static assets; unknown paths fall back to `index.html` for client-side routing.

## Security model

- **Sessions, not bare JWTs** — tokens are encrypted (`dir`/`A256GCM`) and bound to a server-side session row; logout kills the session, so a stolen token dies with it. 24h expiry.
- **Fail-closed secrets** — in production the worker refuses to mint or verify tokens if `JWT_SECRET` is unset.
- **Rate limiting** — login (per-IP and per-email) and registration (per-IP) via an atomic D1 UPSERT; windows reaped by cron. Challenge issuance additionally has per-candidate daily/weekly caps + pairwise cooldowns.
- **Passwords** — PBKDF2-SHA256 (100k iterations, per-user salt), constant-time comparison, complexity policy enforced by Zod.
- **Authorization** — role hierarchy (`voter → candidate_staff → moderator → admin → super_admin`) plus per-candidate staff links; every candidate-scoped mutation verifies the staff link server-side.
- **Content visibility** — unpublished ads (draft/submitted/rejected) return 404 to everyone except owning staff and admins.
- **Headers** — CSP, `X-Frame-Options: DENY`, `nosniff`, referrer and permissions policies on all worker responses; CORS restricted to an explicit origin allowlist.
- **Privacy** — client IPs are stored only as salted SHA-256 hashes; analytics/impression logs are purged after a configurable retention window (default 30 days).
- **Demo data** — fictional seed candidates/ads never seed in production (`ENVIRONMENT=production` gates them; opt back in only with `SEED_DEMO_DATA=true`).

## Development

```bash
npm install
cp .dev.vars.example .dev.vars   # set JWT_SECRET

# Frontend dev server (Vite, proxies nothing — run the worker for the API)
npm run dev

# Full stack locally (build SPA, then run worker + D1 + R2 emulation)
npm run build
npx wrangler dev
```

## Testing

Tests are **real integration tests**: they run the actual worker inside `workerd` (Cloudflare's production runtime) against a real SQLite-backed D1 database via `@cloudflare/vitest-pool-workers`. No mocks.

```bash
npm test          # 32 tests: auth flows, session invalidation, rate limiting,
                  # ad visibility/authorization regressions, challenge credit
                  # lifecycle, audit trail, validation schemas
npm run test:watch
```

## Deployment

```bash
# One-time: create resources + set the production secret
npx wrangler d1 create arena-database          # update database_id in wrangler.toml
npx wrangler r2 bucket create political-arena-media
npx wrangler secret put JWT_SECRET

npm run deploy    # tsc --noEmit + vite build + wrangler deploy
```

CI (GitHub Actions) runs typecheck, build, and the full workerd test suite on every push/PR to `main`.

## Configuration (`wrangler.toml [vars]`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `CHALLENGE_SLA_HOURS` | 72 | Challenge response SLA |
| `REBUTTAL_WINDOW_HOURS` | 48 | Rebuttal window after ad approval |
| `REBUTTAL_RESERVATION_HOURS` | 12 | Rebuttal slot reservation |
| `MAX_REBUTTALS_PER_AD` | 3 | Rebuttal slots per ad |
| `CHALLENGE_COOLDOWN_HOURS` | 24 | Cooldown per challenger→target pair |
| `MAX_CHALLENGES_PER_DAY` / `_WEEK` | 3 / 10 | Per-candidate challenge caps |
| `IMPRESSION_LOG_RETENTION_DAYS` | 30 | Analytics/impression retention |

Secrets (via `wrangler secret put`): `JWT_SECRET` (required in production).
