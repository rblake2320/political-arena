# Parked — deferred until fully up & running

**Append-only.** Add items; do not delete. Check `[x]` when shipped/resolved, but leave the line for history.

---

## 🚨 Go-live blockers (clear before production)
- [ ] **JWT_SECRET not set in Cloudflare secrets** — prod auth 500s/401s without it. Fix: `wrangler secret put JWT_SECRET` (strong random value). R2 binding/bucket + `ENVIRONMENT=production` already present. (Flagged by Codex QA.)

## Redesign follow-ups (branch redesign/arena → PR #1)
- [ ] Media-rich ad players (design 2a–2c): video / audio / image / note ad formats. Demo ads are text-only; `ContentMedia` exists to wire in.
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

## Infra (only when usage proves it)
- [ ] Migrate the accountability ledger D1 → Neon Postgres via Hyperdrive when real records accumulate (D1 10 GB/DB ceiling). Not before.
- [ ] Stack currency: Vite 8 (Rolldown) upgrade; confirm Zod v3 vs v4; pin React ≥ 19.2.1.

## Done this session (kept for history)
- [x] Two-partner redesign: Home (1a), chrome (ticker+nav), Receipt (1c, recites+fact-scores), Race (1b), mobile (1d), QA fixes. 78 tests green on redesign/arena.
- [x] Backend: PBKDF2→600k versioned+rehash, governors (36), write-in API, /api/stats/cycle + /api/feed/live, /api/races candidates_summary + open_callout + challenge_recite_summary, receipt slug backfill, demo questions + recites, status=all support.
- [x] Federal + governor race data loaded to arena-database (512 canonical).
