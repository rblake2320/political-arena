import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ChevronRight, MapPin, Users, Flame, MessageSquare, Swords, Megaphone, TrendingUp, Clock, ArrowUpDown } from "lucide-react";
import { useArenaStore } from "../store";

type SortMode = 'trending' | 'newest' | 'name';

function ActivityBar({ score, max }: { score: number; max: number }) {
  const pct = max > 0 ? Math.min((score / max) * 100, 100) : 0;
  return (
    <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{
          width: `${Math.max(pct, 4)}%`,
          background: pct > 60 ? 'linear-gradient(90deg, #6366f1, #ec4899)'
            : pct > 30 ? 'linear-gradient(90deg, #6366f1, #8b5cf6)'
            : '#4b5563',
        }}
      />
    </div>
  );
}

export function Home() {
  const { races, fetchRaces } = useArenaStore();
  const [loaded, setLoaded] = useState(races.length > 0);
  const [sort, setSort] = useState<SortMode>('trending');

  useEffect(() => {
    fetchRaces(sort).finally(() => setLoaded(true));
  }, [sort]);

  const maxActivity = Math.max(...races.map(r => r.activity_score || 0), 1);

  const sortTabs: { key: SortMode; label: string; icon: typeof TrendingUp }[] = [
    { key: 'trending', label: 'Trending', icon: TrendingUp },
    { key: 'newest', label: 'Newest', icon: Clock },
    { key: 'name', label: 'A-Z', icon: ArrowUpDown },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 py-12">
      {/* Hero */}
      <div className="mb-10">
        <div className="flex items-center gap-2 mb-4">
          <Flame className="w-5 h-5 text-indigo-400" />
          <span className="text-xs font-semibold text-indigo-400 uppercase tracking-widest">Live Now</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4 bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
          Active Arenas
        </h1>
        <p className="text-zinc-400 max-w-2xl text-lg leading-relaxed">
          Watch candidates debate the issues, respond to challenges, and present their cases directly to verified voters. A transparent, fair platform for political discourse.
        </p>
      </div>

      {/* Sort tabs */}
      <div className="flex items-center gap-2 mb-8">
        {sortTabs.map(tab => {
          const Icon = tab.icon;
          const active = sort === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => { setSort(tab.key); setLoaded(false); }}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                active
                  ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                  : 'bg-zinc-900/50 text-zinc-400 border border-zinc-800 hover:border-zinc-700 hover:text-zinc-300'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Race cards */}
      {!loaded ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
        </div>
      ) : races.length === 0 ? (
        <div className="p-12 text-center border border-zinc-800 rounded-2xl bg-zinc-900/30">
          <div className="text-zinc-400 mb-2">No active races</div>
          <div className="text-sm text-zinc-500">Check back soon for upcoming political arenas.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {races.map((race, idx) => {
            const score = race.activity_score || 0;
            const isTrending = sort === 'trending' && idx < 3 && score > 0;
            const isHot = score >= 5;

            return (
              <Link
                key={race.id}
                to={`/race/${race.id}`}
                className={`group block p-6 rounded-2xl border transition-all duration-200 ${
                  isTrending
                    ? 'bg-gradient-to-br from-zinc-900/80 to-indigo-950/30 border-indigo-500/30 hover:border-indigo-400/50 shadow-lg shadow-indigo-500/5'
                    : 'bg-zinc-900/50 border-zinc-800 hover:bg-zinc-800/50 hover:border-zinc-700'
                }`}
              >
                {/* Header row */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-semibold text-indigo-400 tracking-wider uppercase">
                        {race.status}
                      </span>
                      {isHot && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-gradient-to-r from-orange-500/20 to-pink-500/20 text-orange-300 border border-orange-500/30">
                          <Flame className="w-3 h-3" /> Hot
                        </span>
                      )}
                      {isTrending && !isHot && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                          <TrendingUp className="w-3 h-3" /> Trending
                        </span>
                      )}
                    </div>
                    <h2 className="text-xl font-semibold text-white mb-1 group-hover:text-indigo-300 transition-colors truncate">
                      {race.name}
                    </h2>
                  </div>
                  <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-white group-hover:translate-x-0.5 transition-all flex-shrink-0 mt-1" />
                </div>

                {/* Location + candidates */}
                <div className="flex items-center gap-4 text-sm text-zinc-400 mb-4">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-4 h-4" />
                    {race.state} {race.district && `- District ${race.district}`}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Users className="w-4 h-4" />
                    {race.candidate_count} {race.candidate_count === 1 ? "Candidate" : "Candidates"}
                  </div>
                </div>

                {/* Activity bar */}
                <ActivityBar score={score} max={maxActivity} />

                {/* Activity counts */}
                <div className="flex items-center gap-4 mt-3 text-xs text-zinc-500">
                  {(race.challenge_count || 0) > 0 && (
                    <div className="flex items-center gap-1" title="Challenges">
                      <Swords className="w-3.5 h-3.5 text-amber-500/70" />
                      <span>{race.challenge_count}</span>
                    </div>
                  )}
                  {(race.ad_count || 0) > 0 && (
                    <div className="flex items-center gap-1" title="Campaign Ads">
                      <Megaphone className="w-3.5 h-3.5 text-blue-400/70" />
                      <span>{race.ad_count}</span>
                    </div>
                  )}
                  {(race.question_count || 0) > 0 && (
                    <div className="flex items-center gap-1" title="Voter Questions">
                      <MessageSquare className="w-3.5 h-3.5 text-emerald-400/70" />
                      <span>{race.question_count}</span>
                    </div>
                  )}
                  {(race.response_count || 0) > 0 && (
                    <div className="flex items-center gap-1" title="Challenge Responses">
                      <ChevronRight className="w-3.5 h-3.5 text-purple-400/70" />
                      <span>{race.response_count} responses</span>
                    </div>
                  )}
                  {score === 0 && (
                    <span className="text-zinc-600 italic">No activity yet</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Info banner */}
      <div className="mt-14 p-6 rounded-2xl border border-zinc-800 bg-zinc-900/30 flex flex-col md:flex-row items-start md:items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center flex-shrink-0">
          <span className="text-lg">&#127963;</span>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-white mb-1">How Arena Works</h3>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Candidates run ads with mandatory disclaimers. Opponents get equal rebuttal slots.
            Voters issue challenges that candidates must respond to publicly. Full transparency, structured debate.
          </p>
        </div>
      </div>
    </div>
  );
}
