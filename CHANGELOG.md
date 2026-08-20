# Changelog

All notable changes to Political Arena are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/) / Conventional Commits.

## [Unreleased] - 2026-07-16

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
