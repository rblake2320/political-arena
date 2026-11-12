# Political Arena review — October 4, 2026

Review base: `origin/master` at `cd4286c`. Work is isolated on
`codex/review-tech-20261004`; the earlier draft [PR #30](https://github.com/rblake2320/political-arena/pull/30)
remains separate. Its directory coverage, email/identity distinction and sample
labeling changes were inspected to avoid duplicating or overwriting that work.

## Changes and observed defects

| Finding | Observed failure and cause | Repair and permanent check |
|---|---|---|
| Archive overwrite | Two real D1/R2 exports starting in the same second wrote the same object key. The first export disappeared after its source rows had been purged. | Run UUID plus create-only R2 writes, null-write rejection, stable row ordering and actual deletion counts. `retention-regressions.test.js` covers same-second runs, collision refusal, outage/retry, missing bucket and interruption after export. |
| False email receipt | Resend/Postmark HTTP 200 bodies with no valid message ID were logged as sent; provider errors could persist echoed private content. A ledger failure after acceptance attempted a second write labeling the send failed. | Validate provider IDs and Postmark error code, discard provider error bodies, separate ledger failures from send failures. `provider-receipts.test.js` checks malformed replies, error-body privacy and ledger outage. |
| Media protocol | HEAD included a body and honored Range, ETag revalidation was absent, and stale If-Range requests served partial bytes from the current object. Missing media lacked security headers; R2 outages escaped the response boundary. | Body-free HEAD, ETag/Last-Modified, validator precedence, If-Range, conditional content read, retryable replacement/outage responses, 405 for unsupported methods and consistent security headers. `media-http.test.js` exercises the HTTP contract against real local R2. |
| Developer connection | Vite served the SPA without connecting `/api` or `/media` to Wrangler. | Same-origin development proxies to loopback port 8787; verified by actual browser data loading. Replaced `__dirname` with `import.meta.dirname`; native Vite config-loader build passed. |
| Test configuration leakage | With synthetic provider settings in `.dev.vars`, the full suite's readiness checks expected no provider but observed configured=true and a failed outbound request. | Explicitly clear email credentials/endpoints and RSS sources in the test bindings. Existing `edge-cases.test.js` readiness regressions pass even with local provider configuration present. |
| Dependency drift | Initial audit reported five affected package nodes: Axios, Undici, Miniflare, Wrangler and the Worker test pool. | Update direct packages; pin Miniflare's Undici to patched 7.30.0 rather than taking the audit suggestion to downgrade the test pool. Existing sharp 0.35.4 pin remains. Audit is zero. |

The class sweep covered all email adapters/recording paths, both retention tables,
all direct Worker response branches, media range handling, test configuration,
dependency graph and the existing CI workflow. Robots, sitemap and static-error
responses now receive the common security headers too.

The escaped defects had only happy-path archive/provider tests. The new tests
exercise overwrite/refusal/interruption, malformed provider responses and actual
HTTP cache/range semantics. `npm run verify` runs the build, every test and the
dependency audit and is also the CI gate.

## Executed acceptance

- **Worked:** 172 workerd tests plus 3 client-state tests, 175 total. Thirty-one
  Worker regressions were added. Original targeted run: **Failed**, 19/22, with
  the retained transcript identifying the defects before implementation.
- **Worked:** TypeScript check, production SPA build and native Vite config-loader
  build on Windows/Node 24.17.0. TypeScript 7.0.2 upgrade was executed, rather
  than assuming compatibility.
- **Worked:** clean `npm ci` after stopping test servers; dependency audit zero.
  Initial reinstall **Failed** with Windows EPERM on Vite's open Lightning CSS
  native binary. Stopping the owned servers resolved it; no ACL changes.
- **Worked:** 14/14 real local HTTP scenarios: Worker health, built SPA deep link,
  races, synthetic registration/profile, actual PNG upload/readback, HEAD,
  weak ETag/304, matching/stale If-Range, invalid range, security headers and
  server-side session revocation.
- **Worked:** 3/3 running Worker → local HTTP receiver → real D1 scenarios.
  Valid provider ID was recorded as `sent`; empty-200 and rejected-422 were
  recorded as `failed` with no `sent_at` or message ID. Error text did not retain
  the synthetic private marker. Initial attempt **Failed** because Wrangler had
  not loaded the changed `.dev.vars`; explicit restart resolved it.
- **Worked:** browser search/no-match/Clear filters recovery; Vite on port 5173
  displayed the real Worker races. Built app on port 8787 displayed three local
  fixture races. At 390px width, mobile menu opened and document width was 384px,
  with no horizontal overflow.

The 172 Worker tests use local D1/R2 where persistence is under test; provider
replies and fault boundaries are deliberately injected. The three client-state
tests mock API responses. The email HTTP check uses a synthetic local receiver,
not Resend's public service. Its records establish provider-contract handling,
not inbox delivery. Legacy webhook success still means HTTP acknowledgement.

The first HTTP/email receipts name the pre-commit base and were executed with
the implementation uncommitted. They are historical runs, not exact-head
attribution. A committed-head HTTP receipt and the PR CI run are retained by the
review handoff separately.

## Updated technology

React/DOM 19.3.0, Router 8.4.0, Vite 8.3.2, TypeScript 7.0.2, Tailwind 4.3.3,
Axios 1.20.0, jose 6.2.12, Zod 4.6.5, Zustand 5.0.15, Lucide 1.52.0 and
Wrangler 4.147.0. Vitest is 4.1.11: the latest Worker pool's declared peer range
is `^4.1.0`, so Vitest 5 is currently incompatible with that supported pool.

The existing CI uses read-only repository permissions and exact official
checkout 7.0.1/setup-node 7.0.0 commit pins. No deployment workflow was added.
Lockfile and CycloneDX SBOM are retained. Run `npm ci` and `npm run verify` for
the owner verification gate; the README includes loopback-only HTTP/email
acceptance commands and local test configuration.

## Release boundary

Changes are prepared for review, not deployed. No production data, provider
credentials, election imports or policy decisions were changed. Archive retries
may produce duplicate immutable exports, which are preferable to lost records.
An export/purge interruption leaves the completed export and unpurged rows for
retry, as exercised by the injected interruption regression.

The earlier PR #30 is still pending and carries separate material work; this
branch does not replace it or assert that every repository draft is complete.
No production readiness or load-capacity tier is assigned to these local checks.

## Research sources checked

- [Axios 1.20.0 release](https://github.com/axios/axios/releases/tag/v1.20.0): runtime hardening and reliability changes.
- [Undici 7.29.1 security release](https://github.com/nodejs/undici/releases/tag/v7.29.1) and [7.30.0](https://github.com/nodejs/undici/releases/tag/v7.30.0): patched 7.x line and subsequent maintenance.
- [Cloudflare R2 Worker API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/): conditional writes/reads, metadata and ranges.
- [Resend send-email contract](https://resend.com/docs/api-reference/emails/send-email): success returns a message ID.
- [Postmark email contract](https://postmarkapp.com/developer/api/email-api): message ID and per-message error code.
- [TypeScript releases](https://github.com/microsoft/TypeScript/releases): current 7.0.2 compiler.
- [Checkout 7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1) and [setup-node 7.0.0](https://github.com/actions/setup-node/releases/tag/v7.0.0): official current Actions releases; pins resolved through GitHub's API.

Three candidate lessons were captured in the shared engineering Registry:
create-only archive identity, provider receipt validation, and test-provider
configuration isolation. They remain candidates for owner review.
