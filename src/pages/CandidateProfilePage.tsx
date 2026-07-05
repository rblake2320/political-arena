import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { AlertCircle, ExternalLink, FileText, ShieldCheck, Swords, Video } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import * as api from "../api";

function scoreClass(score: number) {
  if (score >= 75) return "text-emerald-300 border-emerald-500/30 bg-emerald-500/10";
  if (score >= 50) return "text-amber-300 border-amber-500/30 bg-amber-500/10";
  return "text-red-300 border-red-500/30 bg-red-500/10";
}

function sourceWithTimestamp(statement: any) {
  if (!statement.source_url) return "";
  if (statement.quote_start_seconds === undefined || statement.quote_start_seconds === null) return statement.source_url;
  try {
    const url = new URL(statement.source_url);
    if (url.hostname.includes("youtube.com") || url.hostname.includes("youtu.be")) {
      url.searchParams.set("t", `${statement.quote_start_seconds}s`);
      return url.toString();
    }
  } catch {}
  return statement.source_url;
}

export function CandidateProfilePage() {
  const { id } = useParams();
  const [profile, setProfile] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.getCandidatePublicProfile(id)
      .then(setProfile)
      .catch((err: any) => setError(err.response?.data?.error || err.message || "Candidate profile not found"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="max-w-xl mx-auto px-4 py-24 text-center">
        <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
        <h1 className="text-2xl font-semibold text-white mb-2">Profile unavailable</h1>
        <p className="text-zinc-400">{error || "This public profile could not be loaded."}</p>
      </div>
    );
  }

  const { candidate, trust, stats, recent_statements, timeline } = profile;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-8 flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div>
          <Link to={`/race/${candidate.race_id}`} className="text-sm text-indigo-300 hover:text-indigo-200">
            {candidate.race_name}
          </Link>
          <h1 className="mt-2 text-4xl font-bold tracking-tight text-white">{candidate.name}</h1>
          <div className="mt-2 text-zinc-400">{candidate.party} - {candidate.race_state} {candidate.race_office}</div>
          {candidate.biography && <p className="mt-4 max-w-3xl text-sm leading-relaxed text-zinc-300">{candidate.biography}</p>}
        </div>
        <div className={`w-full rounded-xl border p-5 md:w-64 ${scoreClass(trust.score)}`}>
          <div className="text-xs font-semibold uppercase tracking-wider opacity-80">Trust Ledger Score</div>
          <div className="mt-2 text-5xl font-bold">{trust.score}</div>
          <div className="mt-2 text-xs opacity-80">Based on responses, evasion, reviewed statements, and verified recites.</div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="Response rate" value={`${trust.response_rate}%`} />
        <Metric label="Avg evasion" value={`${trust.avg_evasion_score}/100`} />
        <Metric label="Verified recites" value={trust.verified_recites} />
        <Metric label="Public statements" value={stats.statements} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
              <Swords className="w-4 h-4 text-amber-300" />
              Accountability Summary
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Metric compact label="Targeted" value={stats.challenges_targeted} />
              <Metric compact label="Responded" value={stats.challenges_responded} />
              <Metric compact label="No response" value={stats.challenges_expired} />
              <Metric compact label="Refused" value={stats.challenges_refused} />
            </div>
          </section>

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
              <FileText className="w-4 h-4 text-indigo-300" />
              Statement Ledger
            </div>
            {recent_statements.length === 0 ? (
              <div className="text-sm text-zinc-500">No public statements logged yet.</div>
            ) : (
              <div className="space-y-3">
                {recent_statements.map((statement: any) => (
                  <div key={statement.id} className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
                    <div className="mb-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-wider">
                      <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-zinc-300">{statement.truth_status}</span>
                      <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-zinc-300">{statement.answer_status}</span>
                      <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-zinc-300">Evasion {statement.evasion_score}/100</span>
                    </div>
                    <p className="text-sm leading-relaxed text-zinc-200">"{statement.statement_text}"</p>
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                      {statement.topic && <span>{statement.topic}</span>}
                      {statement.statement_at && <span>{new Date(statement.statement_at).toLocaleDateString()}</span>}
                      <a href={sourceWithTimestamp(statement)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-300 hover:text-indigo-200">
                        Source <ExternalLink className="w-3 h-3" />
                      </a>
                      {statement.transcript_url && (
                        <a href={statement.transcript_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-300 hover:text-indigo-200">
                          Transcript <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <ShieldCheck className="w-4 h-4 text-emerald-300" />
            Public Timeline
          </div>
          <div className="space-y-4">
            {timeline.map((item: any, index: number) => {
              const external = item.href?.startsWith("http");
              const icon = item.type === "statement" ? <Video className="w-3.5 h-3.5" /> : <Swords className="w-3.5 h-3.5" />;
              const body = (
                <div className="border-l border-zinc-800 pl-3">
                  <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-500">
                    {icon}
                    {item.type}
                  </div>
                  <div className="line-clamp-2 text-sm text-zinc-200">{item.title}</div>
                  <div className="mt-1 text-[11px] text-zinc-600">
                    {item.created_at ? formatDistanceToNow(new Date(item.created_at), { addSuffix: true }) : ""}
                  </div>
                </div>
              );
              return external ? (
                <a key={`${item.type}-${item.id}-${index}`} href={item.href} target="_blank" rel="noreferrer" className="block hover:opacity-90">
                  {body}
                </a>
              ) : (
                <Link key={`${item.type}-${item.id}-${index}`} to={item.href || "#"} className="block hover:opacity-90">
                  {body}
                </Link>
              );
            })}
            {timeline.length === 0 && <div className="text-sm text-zinc-500">No public timeline events yet.</div>}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Metric({ label, value, compact = false }: { label: string; value: string | number; compact?: boolean }) {
  return (
    <div className={`rounded-lg border border-zinc-800 bg-zinc-950/70 ${compact ? "p-3" : "p-4"}`}>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`${compact ? "text-xl" : "text-2xl"} mt-1 font-bold text-white`}>{value}</div>
    </div>
  );
}
