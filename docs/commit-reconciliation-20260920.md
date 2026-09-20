# Pending commit reconciliation - 2026-09-20

Scope: resolve the existing branch and stash backlog into the canonical master.
Archiving commits alone was insufficient: several features were absent from master.

| Historical work | Disposition |
| --- | --- |
| bf5600e, 0ed7acb, 5c37c3c security branch | Superseded by the hardening incorporated in 8135c7c and subsequent master changes. The current security-report suite covers HSTS, analytics impersonation/rate limits, password reset/session invalidation, staff authority, media, question vote limits, survey isolation/upsert, candidate verification and fan-out. Retain the newer implementations. |
| 3df4fb0 pending candidates | Superseded by merged 5bcd5f9 and later verification protections; current security-report and production-wiring tests cover the moderation queue. |
| 1244a34 tracked press sources | Recovered database, API, UI and original test; preserved the newer public feed and added cross-user ownership, normalized-URL restore/dedup and URL validation regressions. |
| 6b3a937 watchlist | Recovered My Arena, candidate/receipt watch controls, event notifications and cron notifications. Adapted UI to the current bounded enriched-watchlist API. Existing race watch controls and the concurrent directory redesign replace the old Home/Race layout. Retained current favorites API and batching. |
| 8d98f2c accountability | Superseded by merged 12a557e two-reviewer proposals/corrections and newer statement/receipt handling. Current edge-case and migration tests cover these workflows. Restored correction routes to the neutrality scan. |
| 15b9e34, a691877 redesign CSP | Superseded by merged scoped-video CSP and direct-media changes; security-report tests exercise allowed frame hosts. |
| d8e432c portable paired media | Recovered the standalone component, example and README; included them in TypeScript checking. Existing unrestricted multipart uploads supersede the old proposed tiered caps. |
| a4404ae demo-seed stash | Rejected after execution: it removes the evidence for chal-3 and fails smoke.test.js 'seeds source-backed demo recites for race summaries and receipts'. Retain current source-backed fixtures. Historical commit remains in the reconciled Git ancestry. |

## Acceptance evidence

- Before restoration: five of six targeted press/watchlist tests fail against the original route/worker implementations. After restoration: six pass.
- Final combined checks: 141 real workerd/D1 tests across 17 files, plus 3 client-state tests, all pass (144 total).
- TypeScript and production Vite build pass, including the recovered portable source.
- npm audit --audit-level=low: zero vulnerabilities after compatible lockfile refresh and sharp 0.35.4 patch override. The Cloudflare pool pins an older Miniflare; the override avoids npm's suggested breaking pool downgrade.
- Browser, built app at loopback port 8794 with isolated local D1 and a synthetic account: tracked source create/persist/remove; candidate watch/persist in My Arena/unsubscribe all worked.
- Notification integration checks cover preferences, inactive subscriptions, cron repeat runs, unserved-callout preservation, and withholding submitted rebuttal text until moderation approves it.

These checks close the commit backlog. They do not authorize a production deployment or turn the separate product roadmap into a completed release.

## Concurrent UI PR #29

The UI session completed and committed fe63199 while reconciliation was underway. Its draft PR was blocked by the development dependency advisories. Integrated its directory filters, accessibility and stale-request fixes after resolving the audit. The combined test script, build and zero-vulnerability audit all passed.
