# Changelog

All notable changes to Political Arena are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/) / Conventional Commits.

## [Unreleased] - 2026-08-20

Full production wiring pass (branch `improve/production-wiring-20260820`):
every audited frontend↔backend contract break, dead-end write loop, and
backend gap closed. Suite: 101 → 116 tests.

### Fixed
- **Email verification is deliverable**: register sends the verification email
  (dev token in non-prod), `POST /api/auth/resend-verification` added, new
  `/verify-email` page + banner. The entire verified-voter layer (priorities,
  questions, question votes) was previously unreachable for real users.
- **Press moderation worked 0% of the time**: frontend sent `{status}` where
  the backend requires `{action}`, and the queue read the wrong response key.
- **Ads/rebuttals no longer die in draft**: dashboard shows all own-ad
  statuses with submit-for-review/activate actions; rebuttals submit straight
  into a new moderation queue (`GET /api/ads/moderation-queue`,
  `PUT /api/ads/rebuttals/:id/review`); ad review resolves its queue row.
- **Fabricated sample ads removed from production**: seeded Daisy/Ike clips
  attributed to real FEC candidates are deleted on bootstrap and all sample
  seeding is gated out of production.
- **Credits**: challenge-creation failure refunds the credit; unserved
  callouts expire after deadline+7d with refund; first verification grants 50
  starter credits (Help now matches actual pricing: 1 credit per callout).
- login/register responses include `staff_links` (candidate portal appeared
  only after a hard refresh); What Matters state filter sends USPS codes;
  challenge takedown (`PUT /api/challenges/:id/visibility`) and question
  hide/restore added; surveys can leave draft; `user_favorites` legacy
  migration actually rebuilds the table; D1 100-parameter limit chunked on
  six query paths; unguarded `JSON.parse` on DB columns made safe.

### Security
- Rate limits added: forgot/reset-password, media uploads, candidate
  registration. Challenger must be a verified candidate to issue callouts.
  Self-registered (`platform_claim`) candidates hidden from public surfaces
  until verified. IP-hash salt moved to `IP_HASH_SALT` env secret.
  `npm audit` clean (react-router CSRF advisory et al.).

### Added
- Cron RSS press-feed ingestion (`PRESS_FEED_RSS_SOURCES`) — the public press
  feed was frozen at 7 seeded July headlines with no ingestion job.
- `GET /api/stats/config` public platform parameters; the race rules panel
  reads it instead of hardcoded literals.
- Real search on the home page (was a decorative span); watch-race subscribe
  toggle (notification fan-out finally reachable); corrections queue in the
  moderation UI; candidate names link to public trust profiles.
- Route-level code splitting: entry chunk 505 kB → 302 kB.
- `CORS_ALLOWED_ORIGINS` for custom domains; analytics endpoints flag
  `impressions_tracking: 'not_implemented'` instead of reporting zeros as data.
- `test/production-wiring.test.js` (11 integration tests) and
  `test/press-ingest.test.js` (4 parser tests).

## [Previous] - 2026-07-16

Production readiness pass (branch `improve/production-ready-20260716`).

### Fixed
- Outbound email provider calls (Resend, Postmark, legacy webhook) now carry a
  10-second `AbortSignal` timeout so a hung provider cannot pin a Worker
  invocation (`src/email.js`).
- Lazy challenge-expiration writes on the race listing endpoint are registered
  with `ctx.waitUntil()` so the runtime cannot cancel them once the response
  streams back (`src/routes/challenges.routes.js`).

### Changed
- Saved-item enrichment (`/api/favorites`, `/api/notifications/watchlist`)
  batch-fetches targets with one `IN (...)` query per type instead of one
  query per row, and both list endpoints are capped at 200 rows
  (`src/routes/saved-items.helpers.js`).
- Dependencies updated to latest minors: wrangler 4.111, vite 8.1.5,
  react-router 8.2, lucide-react 1.24, @cloudflare/vitest-pool-workers 0.18.5.
  TypeScript 7 (new major) deliberately deferred.

### Added
- `test/saved-items.test.js` — first integration coverage for favorites and
  watchlist (happy path, missing target, duplicates, auth, unsubscribe,
  `notify_on` parsing). Suite: 94 → 101 tests.
- Email-provider timeout regression test in `test/email.test.js`.
- Email provider variables documented in `.dev.vars.example`.

### Repository
- Root-level curl artifacts (`cand*.json`, `race*.json`, `chal1.json`) and
  `beta-seed.sql` moved to `data/fixtures/`; manual seed scripts moved to
  `scripts/seed/`; `.gitignore` blocks new root artifacts.

### Known deferred items (need human decision)
- LICENSE file (legal/business choice — repo currently all-rights-reserved by default).
- TypeScript 6 → 7 major upgrade.
- PBKDF2 iteration count (100k) — deliberate Workers CPU tradeoff from
  commit `9ef71fc`; revisit if password hashing moves off the request path.
- Frontend bundle >500 kB — code-splitting via dynamic import.
