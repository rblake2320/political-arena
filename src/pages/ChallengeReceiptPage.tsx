import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { AlertCircle, CheckCircle2, Clock, ExternalLink, FileCheck2, ShieldAlert, ShieldCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import * as api from "../api";
import { ContentMedia } from "../components/Media";

function statusClass(status: string) {
  if (status === "responded") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  if (status === "expired") return "border-red-500/30 bg-red-500/10 text-red-300";
  if (status === "refused") return "border-orange-500/30 bg-orange-500/10 text-orange-300";
  if (status === "withdrawn") return "border-zinc-700 bg-zinc-900 text-zinc-300";
  return "border-amber-500/30 bg-amber-500/10 text-amber-300";
}

function factScoreLabel(label?: string) {
  if (label === "source-supported") return "Source-supported";
  if (label === "source-disputed") return "Source-disputed";
  if (label === "mixed") return "Mixed recites";
  return "Under-recited";
}

function auditChainLabel(status?: string) {
  if (status === "verified") return "Chain verified";
  if (status === "partial") return "Partially verified";
  if (status === "failed") return "Verification failed";
  return "No chain entries";
}

function auditChainClass(status?: string) {
  if (status === "verified") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  if (status === "partial") return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  if (status === "failed") return "border-red-500/30 bg-red-500/10 text-red-300";
  return "border-zinc-700 bg-zinc-900 text-zinc-400";
}

function ReciteList({ recites }: { recites: any[] }) {
  if (!recites.length) {
    return <div className="text-sm text-zinc-500">No public recites attached.</div>;
  }

  return (
    <div className="space-y-3">
      {recites.map(recite => (
        <div key={recite.id} className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
          <div className="flex flex-wrap gap-2 mb-2 text-[10px] uppercase tracking-wider">
            <span className="rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2 py-0.5 text-indigo-300">{recite.source_type}</span>
            <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-zinc-300">{recite.stance}</span>
            <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-zinc-300">{recite.status}</span>
          </div>
          <a href={recite.url} target="_blank" rel="noreferrer" className="inline-flex items-start gap-2 text-sm font-semibold text-white hover:text-indigo-200">
            <span>{recite.title}</span>
            <ExternalLink className="w-4 h-4 mt-0.5 flex-shrink-0 text-zinc-500" />
          </a>
          {recite.publisher && <div className="mt-1 text-xs text-zinc-500">{recite.publisher}</div>}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
            {recite.source_published_at && <span>Published {recite.source_published_at}</span>}
            {recite.accessed_at && <span>Accessed {recite.accessed_at.slice(0, 10)}</span>}
            {recite.archive_url && (
              <a href={recite.archive_url} target="_blank" rel="noreferrer" className="text-indigo-300 hover:text-indigo-200">
                Archived copy
              </a>
            )}
          </div>
          {recite.quote && <div className="mt-3 border-l-2 border-zinc-700 pl-3 text-sm text-zinc-300">"{recite.quote}"</div>}
        </div>
      ))}
    </div>
  );
}

export function ChallengeReceiptPage() {
  const { id } = useParams();
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.getChallengeReceipt(id)
      .then(setData)
      .catch((err: any) => setError(err.response?.data?.error || err.message || "Receipt not found"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-xl mx-auto px-4 py-24 text-center">
        <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
        <h1 className="text-2xl font-semibold text-white mb-2">Receipt unavailable</h1>
        <p className="text-zinc-400">{error || "This receipt could not be loaded."}</p>
      </div>
    );
  }

  const { challenge, response, recites, response_recites, fact_score, response_fact_score, timeline, audit_chain } = data;
  const deadline = challenge.response_deadline ? new Date(challenge.response_deadline) : null;
  const isOpen = challenge.status === "open";

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link to={`/race/${challenge.race_id}`} className="text-sm text-indigo-300 hover:text-indigo-200">
          {challenge.race_name}
        </Link>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider ${statusClass(challenge.status)}`}>
          {challenge.status === "expired" ? "No response by deadline" : challenge.status}
        </span>
      </div>

      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-white">Public Callout Receipt</h1>
        <p className="mt-3 max-w-3xl text-zinc-400">
          {challenge.challenger_name} called out {challenge.target_name}. This receipt records the claim, recites, deadline, and response status.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
              <ShieldAlert className="w-4 h-4 text-amber-300" />
              Claim
            </div>
            {challenge.claim_text && (
              <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-lg font-serif italic text-zinc-100">
                "{challenge.claim_text}"
              </div>
            )}
            <p className="text-sm leading-relaxed text-zinc-300">{challenge.challenge_text}</p>
            {challenge.dispute_summary && (
              <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Why it is disputed</div>
                <p className="text-sm text-zinc-300">{challenge.dispute_summary}</p>
              </div>
            )}
            {challenge.requested_response && (
              <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">Requested response</div>
                <p className="text-sm text-zinc-300">{challenge.requested_response}</p>
              </div>
            )}
            {challenge.media_url && (
              <div className="mt-4">
                <ContentMedia url={challenge.media_url} alt="Callout media" />
              </div>
            )}
          </section>

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <FileCheck2 className="w-4 h-4 text-indigo-300" />
                Recites
              </div>
              <div className="text-xs text-zinc-500">
                {factScoreLabel(fact_score?.label)} - {fact_score?.score ?? 50}/100
              </div>
            </div>
            <ReciteList recites={recites || []} />
          </section>

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
              <CheckCircle2 className="w-4 h-4 text-emerald-300" />
              Tagged Campaign Response
            </div>
            {response ? (
              <div className="space-y-4">
                <p className="text-sm leading-relaxed text-zinc-300">{response.response_text}</p>
                {response.media_url && <ContentMedia url={response.media_url} alt="Response media" />}
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-500">
                  Response fact score: {factScoreLabel(response_fact_score?.label)} - {response_fact_score?.score ?? 50}/100
                </div>
                <ReciteList recites={response_recites || []} />
              </div>
            ) : (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-400">
                {challenge.status === "expired"
                  ? "The tagged campaign did not respond before the public deadline."
                  : challenge.status === "refused"
                    ? `The tagged campaign refused to respond${challenge.refusal_reason ? `: ${challenge.refusal_reason}` : "."}`
                    : "No response has been posted yet."}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
              {audit_chain?.status === "failed" ? (
                <ShieldAlert className="w-4 h-4 text-red-300" />
              ) : (
                <ShieldCheck className="w-4 h-4 text-emerald-300" />
              )}
              Audit Chain
            </div>
            <div className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider ${auditChainClass(audit_chain?.status)}`}>
              {auditChainLabel(audit_chain?.status)}
            </div>
            <div className="mt-3 text-xs text-zinc-500">
              {audit_chain?.checked_entries ?? 0} checked, {audit_chain?.legacy_entries ?? 0} legacy
            </div>
            {audit_chain?.latest_hash && (
              <div className="mt-2 break-all font-mono text-[10px] text-zinc-600">
                {audit_chain.latest_hash}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
              <Clock className="w-4 h-4 text-amber-300" />
              Deadline
            </div>
            {deadline && (
              <div>
                <div className="text-2xl font-bold text-white">{deadline.toLocaleDateString()}</div>
                <div className="mt-1 text-sm text-zinc-500">
                  {isOpen ? formatDistanceToNow(deadline, { addSuffix: true }) : "Closed"}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="mb-3 text-sm font-semibold text-white">Timeline</div>
            <div className="space-y-3">
              {(timeline || []).map((item: any, index: number) => (
                <div key={`${item.action}-${index}`} className="border-l border-zinc-800 pl-3">
                  <div className="text-xs font-medium text-zinc-300">{item.action}</div>
                  <div className="text-[11px] text-zinc-600">
                    {item.created_at ? formatDistanceToNow(new Date(item.created_at), { addSuffix: true }) : ""}
                  </div>
                </div>
              ))}
              {(!timeline || timeline.length === 0) && <div className="text-xs text-zinc-500">No audit events available.</div>}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
