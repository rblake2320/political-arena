# Political Arena Neutrality Architecture

Political Arena separates public facts, accountability records, and paid tools so neutrality can be audited in code instead of asserted in copy.

## Layers

**Public Reference Layer**

Races, offices, districts, election dates, candidates, source provenance, and directory metadata live here. This layer records public facts and must not itself create penalties, scores, deadlines, or negative inferences. A candidate can exist here as `fec_registered`, `state_ballot_certified`, or another source-backed status without having joined the platform.

**Accountability Layer**

Challenges, receipts, recites, responses, statement ledger entries, audit-chain entries, response deadlines, and non-response history live here. This layer may affect public accountability views only when the procedural prerequisites are met: sourced claim, valid actor authorization, public receipt, and served notice to the target through a channel the target controls.

**Commercial Layer**

Subscriptions, invoices, paid analytics, staff seats, storage quotas, premium workflow tools, and billing-provider state live here. This layer may improve private campaign operations. It must never alter public accountability records, fact scores, receipt status, race-view ordering, candidate trust metrics, recite treatment, or deadline behavior.

## Neutrality Invariant

Paid status must not buy accountability advantage.

Commercial-layer fields such as plan, subscription tier, billing status, invoice status, Stripe customer state, or campaign analytics access must not be inputs to:

- public race ordering or candidate ordering
- challenge receipt rendering
- recite visibility, weighting, or fact-score computation
- statement truth, answer, confidence, or evasion display
- response-rate, non-response, or trust-profile calculations
- question ranking or escalation eligibility
- challenge deadline length, expiration, refusal, withdrawal, or response status

This invariant is enforced by `test/neutrality-invariants.test.js`, which scans voter-facing accountability code paths for commercial access inputs. It is intentionally a guardrail against future feature pressure, not a replacement for review.

## Notice Gate

Mere directory presence is not notice.

A candidate listed only in the Public Reference Layer must not accrue non-response marks, response-rate penalties, evasion effects, or trust-profile penalties. Accountability scoring starts only after a served-notice record exists in the Accountability Layer.

Valid notice means one of:

- the candidate or campaign claimed the profile and has active platform staff linked to the candidate
- the platform served notice through a verified official campaign-controlled channel, such as a campaign committee email from a filing or the official campaign website contact channel
- a future provider integration records external delivery status for email, SMS, mail, or another approved channel

No served-notice record means no public non-response mark, even if the challenge can be displayed as an unserved public callout. This keeps broad candidate directories legally and procedurally separate from accountability penalties.

## Cost And Migration Trigger

Infrastructure spend should follow live layers:

- Public Reference testing and light click-through exploration can stay on Cloudflare Workers, D1, and R2.
- Real accountability records should trigger the Postgres migration plan and immutable/external audit-root anchoring.
- Real payments should trigger mature billing through Stripe or equivalent provider controls, not hand-rolled billing logic.

The shared trip-wire is the first real challenge/receipt involving real candidates. At that point, preserve the ledger before it accumulates operational history that is painful to migrate.
