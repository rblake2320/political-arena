# Political Arena

A fair, structured environment for political candidates to campaign, challenge each other, and answer to voters — with accountability built into the platform itself.

**Stack:** Cloudflare Workers · D1 (SQLite) · R2 · React 19 · Vite · Tailwind v4 · Zustand · itty-router · Zod · jose

## What it does

- **Races & candidates** — federal/state/local races with verified candidate profiles.
- **Ad flights** — candidate ads move through a moderated pipeline (`draft → submitted → in_review → approved → active → completed`), each with a mandatory "Paid for by" disclaimer.
- **Dynamic media** — candidates and verified participants can upload or link video, audio, and images from desktop or mobile; uploaded media is served from R2 with browser-native controls and byte-range streaming.
- **Side-by-side rebuttals** — when an Arena ad goes live, opposing candidates in the same race get a reserved rebuttal window. If a high-budget TV/digital ad happens outside Arena, a candidate can post that outside ad as context and publish their lower-cost response beside it. Ads and responses are served as paired units so voters see claim and answer together.
- **Recites & fact scores** — ads, rebuttals, challenges, and challenge responses can be backed with public recites: links to official records, public documents, research, news, campaign materials, or other sources. Recites preserve access dates/archive URLs, support, refute, or add context; moderator verification increases score confidence.
- **Challenges (accountability core)** — candidates formally call out opponents (debate request, fact check, policy question). Fact-check callouts require at least one recite before publication, then the tagged opponent gets a business-day response deadline; non-response is *publicly visible* as `expired`. Targets may respond, refuse (with a stated reason), or the challenger may withdraw. State machine: `open → responded | refused | expired | withdrawn`.
- **Public receipts** — every callout gets a shareable receipt page with the claim, recites, fact score, deadline, response/refusal/expired status, and audit timeline.
- **Trust ledger profiles** — candidate public profiles aggregate response rates, no-response counts, statement reviews, evasion scores, verified recites, and a historical timeline.
- **Timestamped statement archive** — public statements can link to YouTube/video/article sources, transcript URLs, exact timestamps, topics, truth review status, and evasion review status.
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
   ├─ 16 route modules (src/routes/*.routes.js, itty-router)
   ├─ auth.js        PBKDF2 password hashing + encrypted JWT (A256GCM) + session binding
   ├─ middleware.js  auth guards, role checks, CORS allowlist, pagination
   ├─ validation.js  Zod schemas for every write endpoint
   ├─ ratelimit.js   D1-backed fixed-window rate limiter (atomic UPSERT)
   ├─ audit.js       non-blocking append-only audit log (ctx.waitUntil)
   └─ db.js          32 tables + 58 indexes, CREATE IF NOT EXISTS bootstrap + runtime migrations
   │
   ├─ D1  (ARENA_DB)     all relational state
   ├─ R2  (ARENA_MEDIA)  candidate media (video/image/audio), served via /media/*
   └─ Cron (*/15 min)    challenge expiry, ad lifecycle, session/analytics cleanup
```

The Vite-built SPA is served from Workers static assets; unknown paths fall back to `index.html` for client-side routing.

## Security model

- **Sessions, not bare JWTs** — tokens are encrypted (`dir`/`A256GCM`) and bound to a server-side session row; logout kills the session, so a stolen token dies with it. 24h expiry.
- **Fail-closed secrets** — in production the worker refuses to mint or verify tokens if `JWT_SECRET` is unset.
- **Rate limiting** — login (per-IP and per-email), registration (per-IP), email verification, analytics events, vote toggles, and recite submission use D1-backed fixed windows; challenge issuance additionally has per-candidate daily/weekly caps + pairwise cooldowns.
- **Passwords** — PBKDF2-SHA256 (100k iterations, per-user salt), constant-time comparison, complexity policy enforced by Zod.
- **Password reset** — reset tokens are random, stored only as hashes, expire after 1 hour, and invalidate all active sessions after a successful reset. Forgot-password responses are always generic to avoid email enumeration.
- **Authorization** — role hierarchy (`voter → candidate_staff → moderator → admin → super_admin`) plus per-candidate staff links; every candidate-scoped mutation verifies the staff link server-side.
- **Bootstrap health** — `/api/health` reports `database: ok`; if schema/bootstrap fails, it returns `503` with degraded health and other API routes return `503` instead of pretending the app is healthy.
- **Content visibility** — unpublished ads (draft/submitted/rejected) return 404 to everyone except owning staff and admins.
- **Outside ad context** — externally posted TV/digital ads are labeled as context, not as an Arena ad buy by the source campaign.
- **Fact score transparency** — content fact scores are derived from visible recites, their source category, stance, and moderation status; rejected recites are excluded from public scoring.
- **Evidence-first callouts** — fact-check challenges are rejected unless they include an initial recite, and that rejected attempt does not deduct candidate credits.
- **Direct target notifications** — tagged campaign staff receive an in-app notification that links to the public receipt, independent of opt-in subscriptions.
- **Headers** — HSTS, CSP, `X-Frame-Options: DENY`, `nosniff`, referrer and permissions policies on all worker responses, including preflight and streamed media; CORS restricted to an explicit origin allowlist.
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
npm test          # 59 tests: auth/reset flows, session invalidation,
                  # rate limiting, ad visibility/authorization regressions,
                  # challenge credit lifecycle, mobile media upload/streaming,
                  # side-by-side outside ad responses, recites/fact scores,
                  # evidence-required fact-check callouts,
                  # trust ledger statements and public candidate profiles,
                  # smoke workflows, runtime migrations, audit trail, schemas
npm run test:watch
```

## Deployment

```bash
# One-time: create resources + set the production secret
npx wrangler d1 create arena-database          # update database_id in wrangler.toml
npx wrangler r2 bucket create political-arena-media
npx wrangler secret put JWT_SECRET
npx wrangler secret put PASSWORD_RESET_WEBHOOK_URL      # email/service webhook
npx wrangler secret put PASSWORD_RESET_WEBHOOK_TOKEN    # if the webhook requires auth

npm run deploy    # tsc --noEmit + vite build + wrangler deploy
```

CI (GitHub Actions) runs typecheck, build, the full workerd test suite, and `npm audit --audit-level=low` on every push/PR to `master` or `main`.

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
| `PASSWORD_RESET_BASE_URL` | request origin | Base URL used in reset links |
| `PASSWORD_RESET_EXPOSE_DEV_TOKEN` | false | Allows dev/test reset token responses; never enable in production |

Secrets (via `wrangler secret put`): `JWT_SECRET` (required in production), `PASSWORD_RESET_WEBHOOK_URL` (required for real email delivery), and optionally `PASSWORD_RESET_WEBHOOK_TOKEN`.

## Production readiness checks

- Confirm the password-reset webhook delivers email/SMS in the production provider and rejects invalid bearer tokens if `PASSWORD_RESET_WEBHOOK_TOKEN` is set.
- Run `/api/health` after deployment and require `200` with `database: ok`; treat `503` as a failed deploy.
- Keep `ENVIRONMENT=production` and do not set `PASSWORD_RESET_EXPOSE_DEV_TOKEN` or `SEED_DEMO_DATA` in production.
- Run `npm test`, `npm run build`, and `npm audit --audit-level=low` before release; CI enforces the same gates.
