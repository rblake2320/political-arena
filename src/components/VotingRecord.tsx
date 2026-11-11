import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ExternalLink, Landmark } from "lucide-react";
import * as api from "../api";
import { useAuth } from "../stores/auth";

/**
 * Public voting record for a candidate profile.
 * Source-first: every vote links to the official record it came from. The
 * platform shows the vote and nothing else — no score, no characterization.
 * "No record" is a normal state (challengers, governors) and is said plainly.
 */

const POSITION: Record<string, { text: string; cls: string }> = {
  yea: { text: "Yea", cls: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10" },
  nay: { text: "Nay", cls: "text-red-300 border-red-500/40 bg-red-500/10" },
  present: { text: "Present", cls: "text-amber-300 border-amber-500/40 bg-amber-500/10" },
  not_voting: { text: "Not voting", cls: "text-zinc-300 border-zinc-500/40 bg-zinc-500/10" },
};

const PAGE_SIZE = 10;

export function VotingRecord({ candidateId }: { candidateId: string }) {
  const { user } = useAuth();
  const [record, setRecord] = useState<any | null>(null);
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [reporting, setReporting] = useState(false);
  const [reportText, setReportText] = useState("");
  const [reportMsg, setReportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    api.getCandidateVotingRecord(candidateId, page, PAGE_SIZE)
      .then(data => { if (!cancelled) { setRecord(data); setState("ready"); } })
      .catch(() => { if (!cancelled) setState("error"); });
    return () => { cancelled = true; };
  }, [candidateId, page, reload]);

  const submitReport = async () => {
    setSending(true);
    setReportMsg(null);
    try {
      await api.submitCorrection({
        content_type: "candidate",
        content_id: candidateId,
        candidate_id: candidateId,
        reason: "identity_error",
        requested_change: `Voting record: ${reportText.trim()}`,
      });
      setReportText("");
      setReporting(false);
      setReportMsg({ ok: true, text: "Report filed. It goes to the public correction queue and ends in a written ruling." });
    } catch (err: any) {
      setReportMsg({ ok: false, text: err?.response?.data?.error || "The report could not be filed. Try again." });
    } finally {
      setSending(false);
    }
  };

  const total = record?.pagination?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section aria-labelledby="voting-record-heading" className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="mb-1 flex items-center gap-2">
        <Landmark className="h-4 w-4 text-indigo-300" aria-hidden="true" />
        <h2 id="voting-record-heading" className="text-sm font-semibold text-white">Legislative voting record</h2>
      </div>

      {state === "loading" && <p className="mt-3 text-sm text-zinc-400" role="status">Loading voting record…</p>}
      {state === "error" && (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 text-sm text-red-300">
          The voting record could not be loaded.
          <button type="button" onClick={() => setReload(n => n + 1)} className="rounded-md border border-zinc-600 px-3 py-1.5 text-zinc-200 hover:bg-zinc-800">Retry</button>
        </div>
      )}

      {state === "ready" && record && (
        <>
          <p className="mt-2 text-sm leading-relaxed text-zinc-300">{record.note}</p>

          {record.identity && (
            <p className="mt-3 text-xs leading-relaxed text-zinc-400">
              Matched to official record <span className="font-mono text-zinc-200">{record.identity.identifier_value}</span>
              {record.identity.official_name ? ` (${record.identity.official_name})` : ""}. The match was proposed with evidence and confirmed by a second reviewer.{" "}
              <a href={record.identity.evidence_url} target="_blank" rel="noopener noreferrer" className="text-indigo-300 underline hover:text-indigo-200">
                See the match evidence<ExternalLink className="ml-1 inline h-3 w-3" aria-hidden="true" />
              </a>
            </p>
          )}

          {total > 0 && (
            <>
              <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(["yea", "nay", "present", "not_voting"] as const).map(key => (
                  <div key={key} className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                    <dt className="text-xs text-zinc-400">{POSITION[key].text}</dt>
                    <dd className="mt-1 text-xl font-bold text-white">{record.summary[key]}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-xs text-zinc-400">Counts cover the {total} roll call{total === 1 ? "" : "s"} loaded so far, not a full career.</p>

              <ul className="mt-4 divide-y divide-zinc-800 border-y border-zinc-800">
                {record.votes.map((vote: any) => {
                  const pos = POSITION[vote.position] || POSITION.not_voting;
                  return (
                    <li key={vote.roll_call_id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-4">
                      <span className={`inline-flex w-fit shrink-0 items-center rounded-md border px-2.5 py-1 text-xs font-semibold ${pos.cls}`}>{pos.text}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-zinc-100">
                          {vote.bill ? <span className="font-semibold">{String(vote.bill.bill_type).toUpperCase()} {vote.bill.bill_number}{vote.bill.title ? ` — ${vote.bill.title}` : ""}: </span> : null}
                          {vote.question}
                        </div>
                        <div className="mt-1 text-xs text-zinc-400">
                          {vote.vote_date} · {vote.chamber === "senate" ? "Senate" : "House"} roll call {vote.roll_number}, {vote.congress}th Congress
                          {vote.result ? ` · Result: ${vote.result}` : ""}
                        </div>
                        <a href={vote.source_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-indigo-300 underline hover:text-indigo-200">
                          Source: {vote.source_name}<ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {pages > 1 && (
                <nav aria-label="Voting record pages" className="mt-3 flex items-center justify-between text-xs text-zinc-300">
                  <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="rounded-md border border-zinc-700 px-3 py-1.5 disabled:opacity-40">Newer</button>
                  <span>Page {page} of {pages}</span>
                  <button type="button" disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="rounded-md border border-zinc-700 px-3 py-1.5 disabled:opacity-40">Older</button>
                </nav>
              )}
            </>
          )}

          <p className="mt-4 text-xs leading-relaxed text-zinc-400">{record.disclaimer}</p>

          <div className="mt-3 border-t border-zinc-800 pt-3">
            {reportMsg && <p role="status" className={`mb-2 text-xs ${reportMsg.ok ? "text-emerald-300" : "text-red-300"}`}>{reportMsg.text}</p>}
            {!reporting ? (
              user
                ? <button type="button" onClick={() => setReporting(true)} className="text-xs font-semibold text-amber-300 underline hover:text-amber-200">Report an error in this record</button>
                : <span className="text-xs text-zinc-400">Wrong person or wrong vote? <Link to="/login" className="text-indigo-300 underline">Sign in</Link> to report an error.</span>
            ) : (
              <div className="flex flex-col gap-2">
                <label htmlFor="vr-report" className="text-xs font-semibold text-zinc-200">What is wrong? Name the vote or say why this is a different person.</label>
                <textarea id="vr-report" value={reportText} onChange={e => setReportText(e.target.value)} rows={3} maxLength={1900} className="w-full rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm text-zinc-100" />
                <div className="flex gap-2">
                  <button type="button" disabled={sending || reportText.trim().length < 10} onClick={() => void submitReport()} className="rounded-md bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{sending ? "Sending…" : "File report"}</button>
                  <button type="button" onClick={() => setReporting(false)} className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200">Cancel</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
