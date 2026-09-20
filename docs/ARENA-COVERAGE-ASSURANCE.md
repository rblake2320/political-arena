# State coverage, account assurance and Jev wiring comparison

## Implemented

- Every US state and DC is selectable independently of loaded race records.
- Client follows paginated results beyond 600 races. Duplicate IDs, changed totals,
  empty intermediate pages and a 100-request ceiling fail visibly, not as success.
- Stable race-ID tie breakers support pagination across equally ranked races.
- The directory explicitly distinguishes missing coverage from absence of elections.
- Email confirmation no longer sets the generic verification status to verified.
  Participation checks use email confirmation directly. Legacy generic verified
  values cannot bypass the email gate. No historical identity claims are inferred.
- Account settings explains email, self-reported profile and campaign authorization
  separately; participation copy no longer describes email-confirmed people as
  identity-verified voters.
- Registration/profile escalation, ordinary-user candidate verification, token
  replay and session revocation are covered by executable checks.
- Vitest upgraded within 4.x, Wrangler updated, and sharp pinned to patched 0.35.4.
  Preserve the override until the worker test dependency chain supplies a safe version.

## Executed acceptance

- 138 real workerd/D1 integration tests and 8 client unit tests passed (146 total).
- TypeScript check as part of build passed; production frontend build passed.
- Dependency audit: 0 vulnerabilities after repair (original audit: 6 findings).
- Native sharp encode/decode passed; local Wrangler restarted with 4.135.0.
- Local HTTP acceptance: 15/15, including forged privilege fields, email/identity
  separation, authorized participation, denied campaign verification, confirmation
  replay and revoked-session rejection.
- Browser: 52 select options (All states plus 50 states and DC); Alaska selected
  with zero local records shows no-match state, and Clear filters restores 3.
- Browser: actual local sign-in followed by Settings displayed the account
  verification panel, unconfirmed email state, confirmation link and explicit
  self-reported identity/location and separate campaign-authorization explanations.
- Committed implementation 8740759: 15/15 HTTP checks rerun in
  `arena-wiring-committed-20260920.json`; no Jev call on this rerun.
- Exact Jev credential scan found no match in tracked files or built assets.
- More-than-600 recovery uses a 601-record client fixture; server pagination uses
  real D1 equal-rank fixtures. Neither is a populated nationwide election database.

## Actual Jev comparison

Used TypeSafe's documented HTTP endpoint and Choice primitive, server-side key,
and `jev-latest`. See `arena-wiring-jev-20260920.json` for returned model, exact
sanitized request, answers, token usage and timestamps.

Jev reviewed 15 actual HTTP outcomes, 5 explicitly synthetic receipt mutations,
and 1 unexecuted/missing-evidence control. It agreed with deterministic evaluation
on 21/21. The five mutations are not claims that the actual server failed.
Request wall time was about 532ms; usage was 3,834 input and 950 output tokens.
The API supplied token usage, not a dollar invoice; no invented dollar estimate.

For exact expected-versus-observed checks the deterministic evaluator also scored
21/21 without inference. Jev added no detection advantage here. Keep it optional
for semantic review and test suggestions, never as permission/identity authority
or a replacement for execution. This finite run does not enumerate every app path.

The first receipts name the pre-commit base and dirty tracked-diff hash, plus the
runner hash; preserve them as historical runs. Later committed-head receipts are
separate artifacts, not retroactive attribution of the initial execution.

## Provider and owner decisions

## Master reconciliation

PR #29 was merged externally during this work. Synced master cd4286c into this
branch, preserving its press sources, watchlist, notification and paired-media
work. The sole conflict was duplicate sharp overrides and tooling versions;
retained one sharp 0.35.4 override and the tested newer Vitest/Wrangler versions.
Combined acceptance: 144 integration tests + 8 client tests = 152 passing;
build/typecheck passed and npm audit reported 0 vulnerabilities.

## Provider and owner decisions (unchanged)

Independent person/address/voter verification, campaign evidence requirements,
MFA enrollment and nationwide state/local election feeds require a separately
specified provider and policy. No ID-document collection, production deployment,
live election data import or automatic verification was added. The existing generic
historical user verification field is retained for compatibility, not repurposed
as proof of identity. Real election coverage must come from retained official
sources; never fill missing states with invented candidates or races.

TypeSafe references: https://docs.typesafe.ai/api and
https://docs.typesafe.ai/primitives/choice .
