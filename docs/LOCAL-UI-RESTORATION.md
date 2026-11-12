# Local preview and click/import repair — 2026-09-20

## Observed failures and repairs

- The preview moved to an isolated worktree with independent Wrangler state.
  Original state: 479 races, 30 candidates, 53 users, 16 ads, 4 rebuttals.
  Preview state: 3 races, 6 candidates, 14 users, 3 ads, 1 rebuttal.
  The missing imported videos were retained in the original D1/R2 state.
  A private snapshot now powers port 8797. Neither original state tree was replaced.
- Source recite chips were spans rather than links. They now link to HTTP(S)
  source URLs; regression tests reject script URLs.
- Live-wire events had receipt IDs but no navigation. They now link to receipts;
  hover and keyboard focus pause the moving strip.
- Failed race loads remained on Loading indefinitely. They now show an error,
  Retry, and Back to races.
- Post ad had only a URL textbox. It now uses the existing file/link importer.
- Staff navigation was derived from public race candidates. Pending campaign
  claims are deliberately hidden publicly, which also disabled their own staff's
  posting. Private navigation now derives from authenticated staff links; pending
  campaigns remain excluded from public race listings. Server authorization is unchanged.
- Signed-out question entry fetched protected press status unnecessarily; it now
  avoids that request and offers a sign-in link. Submission stays gated.
- Media error state is reset when its source changes.

## Executed acceptance

`npm test`: 144 Worker/D1/R2 integration tests + 10 client tests passed.
`npm run build` (includes typecheck): passed. `npm audit --audit-level=low`: zero vulnerabilities.

`python scripts/check-local-ui.py`: real installed Chrome, headless, local built
Worker; no mocked application APIs. Passed directory/filter/race navigation,
four restored video players, advancing playback, evidence panel expansion,
signed-out question guidance, nonexistent-race retry, and six public pages.
It registered a synthetic local user, confirmed email with the development token,
created a pending campaign, signed in through the UI, imported a retained WebM
through the actual file control, saved a draft, fetched it as its staff user,
and checked the served upload SHA-256 against the original bytes.
Synthetic accounts and drafts remain in the private review snapshot, not production.

Browser UI inspection additionally observed Chevrolet playback advance to 16.96s;
the four native players reached readyState 4 without media errors.

## Retained failed attempts

Initial test harness attempts exposed CSP-blocked string evaluation and the bundled
Chromium build's MP4 codec difference. The harness now uses native assertions and
installed Chrome without weakening CSP. A subsequent real run failed on disabled
Post ad, exposing the pending-campaign/public-cache defect above. Later harness
corrections fixed an incorrectly assumed nested ad response and the expected Help
heading (actual heading: How Arena Works). Failed and successful run records are
retained locally; the final sanitized receipt accompanies this report.

## Reproduce safely

From the worktree, stop only its own preview process before starting:

```powershell
powershell -File scripts/start-local-review.ps1 -StatePath .wrangler/restored-20260920
python scripts/check-local-ui.py
```

The launcher refuses missing state rather than silently creating an empty database.
To preserve another local state, `snapshot-local-state.py SOURCE_V3 NEW_DESTINATION_V3`
uses SQLite backup/integrity checks plus media copies and a hashed private receipt.
Take snapshots when no media writer is active. It is not a cross-service transaction.
Keep `.wrangler` private: it contains account and media data.

Previous tests covered API correctness and a fresh seed but did not assert continuity
of local data across worktrees or run pending-staff UI to file import. The explicit
state launcher and real browser regression now exercise those failures.

This is a local review repair, not a deployment or a claim that every role-specific
workflow has been exhaustively exercised. Nothing was merged or deployed.
