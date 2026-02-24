import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ChevronRight, MapPin, Users, Flame } from "lucide-react";
import { useArenaStore } from "../store";

export function Home() {
  const { races, fetchRaces } = useArenaStore();
  const [loaded, setLoaded] = useState(races.length > 0);

  useEffect(() => {
    if (races.length > 0) {
      setLoaded(true);
    } else {
      // Only fetch if not already loaded by App.tsx
      fetchRaces().finally(() => setLoaded(true));
    }
  }, [races.length]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-12">
      {/* Hero */}
      <div className="mb-14">
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
          {races.map(race => (
            <Link
              key={race.id}
              to={`/race/${race.id}`}
              className="group block p-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800/50 hover:border-zinc-700 transition-all duration-200"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="text-xs font-semibold text-indigo-400 mb-2 tracking-wider uppercase">
                    {race.status}
                  </div>
                  <h2 className="text-xl font-semibold text-white mb-1 group-hover:text-indigo-300 transition-colors">
                    {race.name}
                  </h2>
                </div>
                <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
              </div>

              <div className="flex items-center gap-4 text-sm text-zinc-400">
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-4 h-4" />
                  {race.state} {race.district && `- District ${race.district}`}
                </div>
                <div className="flex items-center gap-1.5">
                  <Users className="w-4 h-4" />
                  {race.candidate_count} {race.candidate_count === 1 ? "Candidate" : "Candidates"}
                </div>
              </div>
            </Link>
          ))}
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
