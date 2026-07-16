# AGENTS.md

This repository is a production-oriented civic accountability platform. Treat it as public-facing election infrastructure, not a demo app.

## Product Mission

Political Arena exists to equalize political communication when money, media access, or institutional connections distort public accountability. The core job is to preserve context, require sourced claims, expose unanswered callouts, and build a durable public record voters can inspect over time.

The product must stay nonpartisan. Do not add features that favor a party, ideology, campaign size, incumbent status, or media outlet.

## Current Core Features

- Side-by-side campaign ads and rebuttals.
- Outside TV/digital ad response flow for lower-cost counter-messaging.
- Evidence-first fact-check callouts with public deadlines.
- Public callout receipts with claim, recites, fact score, response status, and audit timeline.
- Recites: source links that support, refute, or add context.
- Recite moderation queue and review notes.
- Timestamped public statement ledger with source/transcript/timestamp metadata.
- Candidate public trust profiles with response rate, no-response count, evasion score, reviewed statements, verified recites, and timeline.
- Verified voter/press questions and issue-priority aggregation.

## Architecture

- Frontend: React 19, Vite, Tailwind v4, Zustand, React Router.
- Backend: Cloudflare Worker, itty-router route modules.
- Database: Cloudflare D1/SQLite initialized in `src/db.js`.
- Media: Cloudflare R2 via `src/media.js` and upload routes.
- Validation: Zod schemas in `src/validation.js`.
- Auth: encrypted JWT/session binding in `src/auth.js`.
- Tests: real Worker/D1/R2 integration tests using `@cloudflare/vitest-pool-workers`.

Important route modules:

- `src/routes/challenges.routes.js`: callouts, response deadlines, public receipts.
- `src/routes/recites.routes.js`: source-backed recites, fact scores, moderation queue.
- `src/routes/statements.routes.js`: timestamped public statement ledger.
- `src/routes/candidates.routes.js`: public candidate trust profile.
- `src/routes/ads.routes.js`: ads, rebuttals, outside ad response flow.

## Non-Negotiable Product Rules

1. Fact-check callouts must require a specific claim and at least one initial recite.
2. Rejected unsupported fact-check attempts must not deduct candidate credits.
3. A tagged campaign must get a direct in-app notification linking to the public receipt.
4. Fact scores must be transparent and source-derived. Do not present them as magic truth.
5. Recites must preserve durable source metadata when possible: quote, access date, publication date, archive URL, and review notes.
6. Public candidate profiles must show history over time, not just campaign-owned messaging.
7. Non-response must remain visible and easy to inspect.
8. Staff-only dashboards must not be the only way for voters to evaluate a candidate.

## Engineering Rules

- Prefer existing patterns before adding new abstractions.
- Keep route modules small and explicit.
- Validate every write endpoint with Zod.
- Use D1 transactions/batches for coupled state changes.
- Never trust client-supplied identity. Use authenticated user/session data.
- Add or update runtime migrations in `runRuntimeMigrations` when changing existing tables.
- Update `CREATE TABLE IF NOT EXISTS` schemas and migration tests together.
- Add integration tests for behavior, not just unit tests.
- Avoid broad refactors while adding product features.
- Every outbound `fetch` to an external service must set `signal: AbortSignal.timeout(...)` — a hung provider must never pin a Worker invocation.
- Never fire-and-forget a D1 write in a request handler; either `await` it or register it with `ctx.waitUntil()`, otherwise the runtime may cancel it after the response returns.

## Frontend Rules

- Build the actual workflow, not a marketing page.
- Use dense, practical civic/accountability UI.
- Keep public receipt/profile pages voter-readable and source-first.
- Do not hide critical accountability state behind hover-only or staff-only views.
- Keep mobile layouts usable; campaigns and voters may post from phones.

## Verification Gates

Before considering work complete, run:

```bash
npm test
npm run typecheck
npm run build
npm audit --audit-level=low
```

For backend workflow changes, also perform a local HTTP smoke test against `wrangler dev` when practical.

## Current Known External Gaps

These require real external providers or policy/legal decisions:

- Outbound email/SMS delivery for callout notifications and password reset.
- Real voter identity/address/district verification.
- Production video transcoding, thumbnails, captions, and format normalization.
- Copyright/fair-use/takedown workflow for reposted outside ads.
- Legal review for election-law disclaimers and defamation policy.

Do not pretend these are solved locally unless provider integration and policy are actually implemented.

