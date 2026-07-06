# Parked — deferred until fully up & running

**Append-only.** Add items; do not delete. Check `[x]` when shipped/resolved, but leave the line for history.

---

## 🚨 Go-live blockers (clear before production)
- [x] **JWT_SECRET set in Cloudflare secrets** (Codex/Ron). Was the cause of registration "Internal server error" — register inserted the user then failed closed creating the JWE under ENVIRONMENT=production. Now present (`wrangler secret list`), mirrored to local `.dev.vars`; register + login verified working. R2 + ENVIRONMENT=production also present. **No go-live blockers remain.**

## Redesign follow-ups (branch redesign/arena → PR #1)
- [x] Media-rich ad players: `ContentMedia` plays native `<video>`/`<audio>` (play button + controls) and YouTube/Vimeo embeds. Root cause of "video won't play" was **CSP had no `frame-src`** for embed hosts (fixed 15b9e34: youtube-nocookie + vimeo in worker HTML_CSP + public/_headers). **Lesson: direct video files (R2 candidate uploads, public-domain demo .webm/.mp4) are the reliable path** — they play under `media-src https:` with no embedding-permission/iframe gamble; YouTube embeds are best-effort (can be disabled per-video → falls back to an open-link). Demo ad now seeded with a direct public-domain file (Codex). CSP fix + seed still need to reach `master` (PR #1 merged).
- [x] Staff write-action modals in redesigned Race (Codex bcaa036): claim profile, issue sourced callout, respond/refuse/withdraw, post ad, answer outside ad, claim rebuttal, submit question. Evidence-first (fact-check requires initial recite), notice-gate copy, server-gated. Playwright smoke clean.
- [ ] Nav: candidate-portal / press / notifications / user-menu links not yet fully restyled to the new chrome (functional, close).
- [ ] Final QA of the new modals against the **live** API (creates/refuse/withdraw round-trips), not just smoke.

## Data / backend
- [ ] Production race dedup: 6 legacy/demo duplicates (AL Senate, FL Senate, TX Governor) vs canonical — 512 canonical (476 federal + 36 gov) vs 518 total. Remove the 3 demo races **at launch** (they carry the demo challenges/recites/questions the live demo runs on — keep until then).
- [ ] Demo receipt audit chains show `NO CHAIN ENTRIES` (seed fixtures not written through `auditLogNow`). Real challenge flow produces a verified chain. Optionally seed a chain-backed demo receipt for the demo.
- [ ] Candidate data labels: `election-data-2026` is FEC-registered/listed, **not** state ballot-certified. Add a state ballot-certification source (per-state SOS / VIP) before treating candidates as certified.

## Product / integrity (from architecture review)
- [ ] Audit chain is tamper-**evident**, not tamper-**proof**. Add an external anchor the operator can't rewrite: R2 Bucket Locks (R2 has Object Lock since Mar 2025) and/or OpenTimestamps, publishing a Merkle/global root so truncation + operator-rewrite are detectable. Keep UI copy "tamper-evident" until then.
- [ ] Neutrality invariant: keep the CI test enforcing no billing/subscription input in public accountability files as commercial features land.
- [ ] Notice-gate: only count non-response against candidates verifiably **served** through a channel they control (claimed profile or verified official contact) — never mere directory existence.

## External / operational (real-world gaps for the notice-gate to be real)
- [ ] Production email/SMS + a **real served-notice channel** to a candidate's verified contact. Until this exists, "verified served-notice record" has no delivery mechanism — non-response can only be counted for candidates who claimed a profile, not merely served in-app. (Codex flagged.)

## Next epic — candidate profiles + video + cold-start outreach (post-redesign)
Mostly wiring on existing infra (R2 uploads / media_uploads / ContentMedia, computeFactScore, loaded FEC cn26 incl. committee contact, issue_positions stub, notice-gate in docs/neutrality-architecture.md). Build order:
1. **Notice-gate + outreach FIRST (with legal/ToS review — highest risk).** Deliver a callout notice to a non-participating candidate's PUBLIC official channels only: FEC committee email → official site contact → listed social handle. Log each attempt (method + timestamp) in the audit chain as a served-notice record. Rules: notice is strictly procedural/factual ("a public callout naming you was filed on [date]; receipt: … ; you may respond"), never characterizes the claim; rate-limited so no one mass-notifies (naming N opponents ≠ N spam blasts); CAN-SPAM compliant (identify sender + opt-out) for email; social @mention = platform publicly naming a person → defamation surface, keep factual, ToS per platform. Expired status only after a *verified* delivery attempt.
2. **Two-layer profiles.** Layer 1 = public-sourced, attributed per source ("per FEC filing X" / "per [outlet] [date]"), platform asserts nothing as true, **no score/no clock until served-notice**; candidate may append corrections, not delete. Layer 2 = candidate-owned, opt-in after claim, badged "Stated by [Name]"; auto fact-check only on specific claims.
   - Layer 1 data types: FEC finance, news citations, and **legislative voting records** ("promised X, voted Y"). NOT critical / not a launch blocker — it's a public-sourced content type. **Incumbent-only** (challengers have none; governors have no legislative record — UI must treat "no record" as normal). Sources: Congress.gov API (federal), OpenStates (state-leg, partial). Requires FEC→bioguide **identity match** (wrong-person risk). **Normalize**: `bills` + `member_votes(candidate×bill→vote_type,date,source)` + `bill_cosponsors` — not a denormalized voting_records table. Source-attributed, no clock, correction path.
3. **Video slots** (R2 + media_uploads + ContentMedia): intro 90s + platform videos + response videos. **Tiered length rule (Ron):** original/TV ad = up to ~5 min (load full TV ads); replies capped at **2 min** (focused). Response video names an opponent → notification + outreach (viral loop; rate-limited per #1).
   - **⚠️ Upload caps must be raised for 5-min video.** Current config: 100MB size + **60s** duration (`SIZE_LIMITS_MB.video`, `typeConfig.maxSize`, `/api/uploads/info max_duration_seconds`) — tuned for Shorts. For 5-min: raise size → **~500MB**, duration → **300s** (replies → 120s); add **R2 multipart** to the presign flow (a ~300MB single PUT is fragile); confirm **range/streaming on serve** (`r2MediaResponse` passes request → R2 supports Range → verify 206/Content-Range so big videos stream, not full-download). Storage is not a constraint: R2 (5GB single / 5TB multipart), $0.015/GB-mo, **$0 egress** (big for video serving).
4. **Money equalizer.** Posting new content costs credits; **replying to anything aimed at you is ALWAYS FREE** (never paywall the defense); proactively posting content that names/attacks an opponent may cost ($0–100, configurable); fact-check meter is automatic + never pay-influenced. More spend = more fact-check meters attached, not bought silence. Must pass the neutrality-invariant CI test (no billing input in accountability/public files).
5. Candidate profile **claim flow** UX that triggers the notice-gate and unlocks Layer 2 self-authoring.

## Response-video evasion meter (extends public_statements answer_status/evasion_score)
- [ ] response video tethered at submission: response_to_id + response_to_type (ad/callout/statement); untagged → paid ad pipeline, not a free reply.
- [ ] post-publish evasion review vs the tagged claim: answer_status direct/partial/evasive/off_topic + evasion_score, shown publicly under the video. **Never auto-revoke the free reply before publish** (suppression argument) — score post-publish, throttle prospectively.
- [ ] prospective throttle: after N consecutive evasive/off_topic vs the same opponent, next reply routes to paid pipeline (configurable, like CHALLENGE_SLA_HOURS). Log score + scorer in audit chain.
- Schema: response_to_id/type, answer_status, evasion_score on the response-video table; reply_throttle_log.

## Gaps beyond the deep-research list (Claude review — highest-leverage first)
- [ ] **Correction/appeal workflow.** The neutrality disclaimer now *promises* corrections; there is no mechanism to receive a dispute (Layer 1 data, a fact-check, an evasion score), act on it, and version the fix into the audit chain. Build the process behind the promise.
- [ ] **Moderator accountability.** The whole moat rests on moderator calls (evasion, recite/candidate verify, disclaimer approval). Add: every mod action logged with *who*; contested/high-stakes calls need 2+ reviewers or an appeal path; a *published* moderation rubric. Must exist BEFORE the first published evasion score.
- [ ] **Layer 1 identity/accuracy.** Disambiguation/identity-confidence before publishing a public-sourced profile (avoid wrong-person/stale/misattributed data) + prominent "report an error" → correction workflow.
- [ ] **Inbound abuse + jurisdiction.** Velocity/dedup limits on callouts/questions so a brigade can't manufacture an "unanswered" wall; jurisdiction eligibility (or out-of-jurisdiction labeling) on voter accountability actions.
- [ ] **ToS + content agreement + retention/deletion policy** before candidates upload video (ownership, post-election lifecycle, deletion vs append-only chain).
- [ ] **Accessibility (WCAG contrast on the near-black/gray design) + Spanish** for real FL/TX/CA civic reach (ADA exposure).
- [ ] **Password reset email** (parked separately below) and **served-notice email provider** are the two launch-blocking email gaps.
- [ ] Also surfaced: sub-issue drill-down UI (parent_category_id planted), cross-candidate statement comparison UI, write-in aggregate surfacing (data collected, nowhere shown), press-citation source weight in fact scores, top-voted-question → challenge escalation, FEC disclaimer language enforcement on ad approval, DMCA/takedown workflow, state ballot-certification source.

## Infra (only when usage proves it)
- [ ] Migrate the accountability ledger D1 → Neon Postgres via Hyperdrive when real records accumulate (D1 10 GB/DB ceiling). Not before.
- [ ] Stack currency: Vite 8 (Rolldown) upgrade; confirm Zod v3 vs v4; pin React ≥ 19.2.1.

## Done this session (kept for history)
- [x] Two-partner redesign: Home (1a), chrome (ticker+nav), Receipt (1c, recites+fact-scores), Race (1b), mobile (1d), QA fixes. 78 tests green on redesign/arena.
- [x] Backend: PBKDF2→600k versioned+rehash, governors (36), write-in API, /api/stats/cycle + /api/feed/live, /api/races candidates_summary + open_callout + challenge_recite_summary, receipt slug backfill, demo questions + recites, status=all support.
- [x] Federal + governor race data loaded to arena-database (512 canonical).
