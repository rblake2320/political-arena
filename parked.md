# Parked — deferred until fully up & running

**Append-only.** Add items; do not delete. Check `[x]` when shipped/resolved, but leave the line for history.

---

## 🚨 Go-live blockers (clear before production)
- [x] **JWT_SECRET set in Cloudflare secrets** (Codex/Ron). Was the cause of registration "Internal server error" — register inserted the user then failed closed creating the JWE under ENVIRONMENT=production. Now present (`wrangler secret list`), mirrored to local `.dev.vars`; register + login verified working. R2 + ENVIRONMENT=production also present. **No go-live blockers remain.**

## Redesign follow-ups (branch redesign/arena → PR #1)
- [ ] Media-rich ad players (design 2a–2c): video / audio / image / note ad formats. Demo ads are text-only; `ContentMedia` exists to wire in.
- [x] Staff write-action modals in redesigned Race (Codex bcaa036): claim profile, issue sourced callout, respond/refuse/withdraw, post ad, answer outside ad, claim rebuttal, submit question. Evidence-first (fact-check requires initial recite), notice-gate copy, server-gated. Playwright smoke clean.
- [ ] Nav: candidate-portal / press / notifications / user-menu links not yet fully restyled to the new chrome (functional, close).
- [ ] Final QA of the new modals against the **live** API (creates/refuse/withdraw round-trips), not just smoke.

## Data / backend
- [x] Production race dedup: canonical production baseline is clean at 512 active races (441 House + 35 Senate + 36 Governor), with 0 active races missing candidates.
- [ ] Demo receipt audit chains show `NO CHAIN ENTRIES` (seed fixtures not written through `auditLogNow`). Real challenge flow produces a verified chain. Optionally seed a chain-backed demo receipt for the demo.
- [ ] Candidate data labels: `election-data-2026` is FEC-registered/listed, **not** state ballot-certified. Add a state ballot-certification source (per-state SOS / VIP) before treating candidates as certified.

## Product / integrity (from architecture review)
- [x] Audit-chain external anchor: global roots publish to R2 under `audit-anchors/`, R2 Bucket Lock is configured with indefinite retention, and readiness verifies `AUDIT_ANCHOR_WORM_CONFIRMED=true`. Keep UI copy "tamper-evident" unless/until legal approves stronger language.
- [ ] Neutrality invariant: keep the CI test enforcing no billing/subscription input in public accountability files as commercial features land.
- [x] Notice-gate: non-response is gated on a served-notice record through a candidate-controlled channel. Unserved callouts cannot expire into public non-response.

## External / operational (real-world gaps for the notice-gate to be real)
- [ ] Production email/SMS + a **real served-notice channel** to a candidate's verified contact. Resend API key is configured, but launch readiness still requires `EMAIL_FROM` from a verified sender/domain.

## Next epic — candidate profiles + video + cold-start outreach (post-redesign)
Mostly wiring on existing infra (R2 uploads / media_uploads / ContentMedia, computeFactScore, loaded FEC cn26 incl. committee contact, issue_positions stub, notice-gate in docs/neutrality-architecture.md). Build order:
1. **Notice-gate + outreach FIRST (with legal/ToS review — highest risk).** Deliver a callout notice to a non-participating candidate's PUBLIC official channels only: FEC committee email → official site contact → listed social handle. Log each attempt (method + timestamp) in the audit chain as a served-notice record. Rules: notice is strictly procedural/factual ("a public callout naming you was filed on [date]; receipt: … ; you may respond"), never characterizes the claim; rate-limited so no one mass-notifies (naming N opponents ≠ N spam blasts); CAN-SPAM compliant (identify sender + opt-out) for email; social @mention = platform publicly naming a person → defamation surface, keep factual, ToS per platform. Expired status only after a *verified* delivery attempt.
2. **Two-layer profiles.** Layer 1 = public-sourced, attributed per source ("per FEC filing X" / "per [outlet] [date]"), platform asserts nothing as true, **no score/no clock until served-notice**; candidate may append corrections, not delete. Layer 2 = candidate-owned, opt-in after claim, badged "Stated by [Name]"; auto fact-check only on specific claims.
   - Layer 1 data types: FEC finance, news citations, and **legislative voting records** ("promised X, voted Y"). NOT critical / not a launch blocker — it's a public-sourced content type. **Incumbent-only** (challengers have none; governors have no legislative record — UI must treat "no record" as normal). Sources: Congress.gov API (federal), OpenStates (state-leg, partial). Requires FEC→bioguide **identity match** (wrong-person risk). **Normalize**: `bills` + `member_votes(candidate×bill→vote_type,date,source)` + `bill_cosponsors` — not a denormalized voting_records table. Source-attributed, no clock, correction path.
3. **Video slots** (R2 + media_uploads + ContentMedia): intro 90s + up to 5×120s platform videos + up to 5×60–90s response videos. Response video names an opponent → notification + outreach to that opponent (the viral loop; rate-limited per #1).
4. **Money equalizer.** Posting new content costs credits; **replying to anything aimed at you is ALWAYS FREE** (never paywall the defense); proactively posting content that names/attacks an opponent may cost ($0–100, configurable); fact-check meter is automatic + never pay-influenced. More spend = more fact-check meters attached, not bought silence. Must pass the neutrality-invariant CI test (no billing input in accountability/public files).
5. Candidate profile **claim flow** UX that triggers the notice-gate and unlocks Layer 2 self-authoring.

## Response-video evasion meter (extends public_statements answer_status/evasion_score)
- [ ] response video tethered at submission: response_to_id + response_to_type (ad/callout/statement); untagged → paid ad pipeline, not a free reply.
- [ ] post-publish evasion review vs the tagged claim: answer_status direct/partial/evasive/off_topic + evasion_score, shown publicly under the video. **Never auto-revoke the free reply before publish** (suppression argument) — score post-publish, throttle prospectively.
- [ ] prospective throttle: after N consecutive evasive/off_topic vs the same opponent, next reply routes to paid pipeline (configurable, like CHALLENGE_SLA_HOURS). Log score + scorer in audit chain.
- Schema: response_to_id/type, answer_status, evasion_score on the response-video table; reply_throttle_log.

## Gaps beyond the deep-research list (Claude review — highest-leverage first)
- [x] **Correction/appeal workflow.** Public submission, moderation queue, public correction history, and readiness gate are implemented.
- [x] **Moderator accountability.** Published rubric and second-review queue are implemented; readiness verifies the public rubric path and review queue.
- [ ] **Layer 1 identity/accuracy.** Disambiguation/identity-confidence before publishing a public-sourced profile (avoid wrong-person/stale/misattributed data) + prominent "report an error" → correction workflow.
- [ ] **Inbound abuse + jurisdiction.** Velocity/dedup limits on callouts/questions so a brigade can't manufacture an "unanswered" wall; jurisdiction eligibility (or out-of-jurisdiction labeling) on voter accountability actions.
- [ ] **ToS + content agreement + retention/deletion policy** before candidates upload video (ownership, post-election lifecycle, deletion vs append-only chain).
- [ ] **Accessibility (WCAG contrast on the near-black/gray design) + Spanish** for real FL/TX/CA civic reach (ADA exposure).
- [ ] **Password reset email** and **served-notice email provider** are wired to the transactional email adapter, but production launch remains blocked until `EMAIL_FROM` is set to a verified sender.
- [ ] Also surfaced: sub-issue drill-down UI (parent_category_id planted), cross-candidate statement comparison UI, write-in aggregate surfacing (data collected, nowhere shown), press-citation source weight in fact scores, top-voted-question → challenge escalation, FEC disclaimer language enforcement on ad approval, DMCA/takedown workflow, state ballot-certification source.

## Infra (only when usage proves it)
- [ ] Migrate the accountability ledger D1 → Neon Postgres via Hyperdrive when real records accumulate (D1 10 GB/DB ceiling). Not before.
- [ ] Stack currency: Vite 8 (Rolldown) upgrade; confirm Zod v3 vs v4; pin React ≥ 19.2.1.

## Done this session (kept for history)
- [x] Two-partner redesign: Home (1a), chrome (ticker+nav), Receipt (1c, recites+fact-scores), Race (1b), mobile (1d), QA fixes. 78 tests green on redesign/arena.
- [x] Backend: PBKDF2→600k versioned+rehash, governors (36), write-in API, /api/stats/cycle + /api/feed/live, /api/races candidates_summary + open_callout + challenge_recite_summary, receipt slug backfill, demo questions + recites, status=all support.
- [x] Federal + governor race data loaded to arena-database (512 canonical).
