import { useState, useEffect } from "react";
import { Link } from "react-router";
import { BarChart3, Users, ArrowRight } from "lucide-react";
import * as api from "../api";
import { useAuth } from "../stores/auth";

const US_STATES = [
  "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut","Delaware",
  "Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa","Kansas","Kentucky",
  "Louisiana","Maine","Maryland","Massachusetts","Michigan","Minnesota","Mississippi",
  "Missouri","Montana","Nebraska","Nevada","New Hampshire","New Jersey","New Mexico",
  "New York","North Carolina","North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania",
  "Rhode Island","South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont",
  "Virginia","Washington","West Virginia","Wisconsin","Wyoming"
];

export function WhatMattersPage() {
  const { user } = useAuth();
  const [stateFilter, setStateFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [overlap, setOverlap] = useState<any>(null);

  useEffect(() => {
    setLoading(true);
    const params = stateFilter ? { state: stateFilter } : undefined;
    api.getCrossPartyOverlap(params)
      .then(data => setOverlap(data))
      .catch(() => setOverlap(null))
      .finally(() => setLoading(false));
  }, [stateFilter]);

  const demTop5 = overlap?.democrat_top5 || [];
  const repTop5 = overlap?.republican_top5 || [];
  const overlapIssues = overlap?.overlap || [];
  const maxVoters = Math.max(
    ...demTop5.map((d: any) => d.voter_count || 0),
    ...repTop5.map((r: any) => r.voter_count || 0),
    1
  );

  return (
    <div className="max-w-5xl mx-auto px-4 py-12">
      {/* Hero */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-medium mb-4">
          <BarChart3 className="w-3.5 h-3.5" />
          Patent-Pending Voter Intelligence
        </div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-white mb-4">
          What Matters to Voters
        </h1>
        <p className="text-lg text-zinc-400 max-w-2xl mx-auto">
          Real priorities from verified voters — not pollsters, not pundits.
          See where both parties actually agree, and where they diverge.
        </p>
      </div>

      {/* State filter */}
      <div className="flex justify-center mb-10">
        <select
          className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500 transition-colors min-w-[200px]"
          value={stateFilter}
          onChange={e => setStateFilter(e.target.value)}
        >
          <option value="">All States</option>
          {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Cross-party overlap banner */}
          {overlapIssues.length > 0 && (
            <div className="mb-12 p-6 rounded-2xl bg-gradient-to-r from-blue-950/40 via-indigo-950/40 to-red-950/40 border border-indigo-500/20">
              <div className="flex items-center gap-2 mb-4">
                <Users className="w-5 h-5 text-indigo-400" />
                <h2 className="text-lg font-bold text-white">Common Ground</h2>
              </div>
              <p className="text-sm text-zinc-400 mb-4">
                Both Democrats and Republicans rank these issues in their top 5:
              </p>
              <div className="flex flex-wrap gap-3">
                {overlapIssues.map((issue: any) => (
                  <div key={issue.id} className="px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 backdrop-blur">
                    <div className="text-white font-semibold">{issue.name}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Side-by-side priorities */}
          {(demTop5.length > 0 || repTop5.length > 0) ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12">
              {/* Democrat */}
              <div className="rounded-2xl border border-blue-500/20 bg-blue-950/10 p-6">
                <h3 className="text-lg font-bold text-blue-400 mb-6 flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-blue-500" />
                  Democrat Top 5
                </h3>
                <div className="space-y-4">
                  {demTop5.length > 0 ? demTop5.map((item: any, i: number) => (
                    <div key={item.id}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-white font-medium">#{i + 1} {item.name}</span>
                        <span className="text-zinc-500">{item.voter_count} voters</span>
                      </div>
                      <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all duration-700"
                          style={{ width: `${Math.max((item.voter_count / maxVoters) * 100, 5)}%` }}
                        />
                      </div>
                    </div>
                  )) : (
                    <p className="text-sm text-zinc-500">No Democrat votes yet</p>
                  )}
                </div>
              </div>

              {/* Republican */}
              <div className="rounded-2xl border border-red-500/20 bg-red-950/10 p-6">
                <h3 className="text-lg font-bold text-red-400 mb-6 flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-red-500" />
                  Republican Top 5
                </h3>
                <div className="space-y-4">
                  {repTop5.length > 0 ? repTop5.map((item: any, i: number) => (
                    <div key={item.id}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-white font-medium">#{i + 1} {item.name}</span>
                        <span className="text-zinc-500">{item.voter_count} voters</span>
                      </div>
                      <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-red-500 rounded-full transition-all duration-700"
                          style={{ width: `${Math.max((item.voter_count / maxVoters) * 100, 5)}%` }}
                        />
                      </div>
                    </div>
                  )) : (
                    <p className="text-sm text-zinc-500">No Republican votes yet</p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-12 text-center border border-zinc-800 rounded-2xl bg-zinc-900/30 mb-12">
              <BarChart3 className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
              <div className="text-zinc-400 mb-2">No voter priorities yet{stateFilter ? ` for ${stateFilter}` : ""}</div>
              <div className="text-sm text-zinc-500">Be the first to rank what matters to you.</div>
            </div>
          )}

          {/* CTA */}
          <div className="text-center p-8 rounded-2xl bg-gradient-to-br from-indigo-950/30 to-violet-950/30 border border-indigo-500/20">
            <h3 className="text-xl font-bold text-white mb-2">Your Voice Matters</h3>
            <p className="text-zinc-400 mb-6 max-w-md mx-auto">
              Rank the issues that matter most to you. Your priorities help shape
              the conversation and hold candidates accountable.
            </p>
            <Link
              to={user ? "/my-priorities" : "/login"}
              className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors"
            >
              Rank Your Priorities
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
