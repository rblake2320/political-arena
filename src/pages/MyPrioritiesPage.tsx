import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { Check, Edit2 } from "lucide-react";
import * as api from "../api";
import { useAuth } from "../stores/auth";

// Icon mapping — display icon name from DB as colored circle with initial
const ICON_COLORS: Record<string, string> = {
  "heart-pulse": "bg-rose-500",
  "trending-up": "bg-emerald-500",
  "graduation-cap": "bg-blue-500",
  "globe": "bg-amber-500",
  "leaf": "bg-green-500",
  "home": "bg-violet-500",
  "shield": "bg-slate-500",
  "receipt": "bg-yellow-500",
  "scale": "bg-orange-500",
  "cpu": "bg-cyan-500",
  "construction": "bg-zinc-500",
  "shield-check": "bg-indigo-500",
};

function CategoryIcon({ icon, name }: { icon: string; name: string }) {
  const bgColor = ICON_COLORS[icon] || "bg-zinc-600";
  return (
    <div className={`w-10 h-10 rounded-xl ${bgColor} flex items-center justify-center text-white font-bold text-sm`}>
      {name.charAt(0)}
    </div>
  );
}

export function MyPrioritiesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [categories, setCategories] = useState<any[]>([]);
  const [existingPriorities, setExistingPriorities] = useState<any[]>([]);
  const [selectedRanks, setSelectedRanks] = useState<Record<string, number>>({});
  const [nextRank, setNextRank] = useState(1);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    if (!user) { navigate("/login"); return; }
    Promise.all([
      api.getIssueCategories(),
      api.getMyPriorities().catch(() => ({ priorities: [] })),
    ]).then(([catData, priData]) => {
      setCategories(catData.categories || []);
      const existing = priData.priorities || [];
      setExistingPriorities(existing);
      if (existing.length > 0) {
        const ranks: Record<string, number> = {};
        existing.forEach((p: any) => { ranks[p.issue_category_id] = p.priority_rank; });
        setSelectedRanks(ranks);
        setNextRank(existing.length + 1);
      }
    }).finally(() => setLoading(false));
  }, [user]);

  const toggleCategory = (catId: string) => {
    setSelectedRanks(prev => {
      const copy = { ...prev };
      if (copy[catId]) {
        // Remove and reorder
        const removedRank = copy[catId];
        delete copy[catId];
        Object.keys(copy).forEach(k => {
          if (copy[k] > removedRank) copy[k]--;
        });
        setNextRank(Object.keys(copy).length + 1);
        return copy;
      }
      if (Object.keys(copy).length >= 5) return copy; // Max 5
      copy[catId] = Object.keys(copy).length + 1;
      setNextRank(Object.keys(copy).length + 1);
      return copy;
    });
  };

  const handleSubmit = async () => {
    const priorities = Object.entries(selectedRanks).map(([catId, rank]) => ({
      issue_category_id: catId,
      priority_rank: rank,
    }));
    if (priorities.length === 0) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      await api.submitPriorities({ priorities });
      setSuccess(true);
      setExistingPriorities(priorities.map(p => ({
        ...p,
        category_name: categories.find(c => c.id === p.issue_category_id)?.name,
        icon: categories.find(c => c.id === p.issue_category_id)?.icon,
      })));
      setEditing(false);
    } catch (err: any) {
      setSubmitError(err.response?.data?.error || "Failed to save priorities. Please verify your account and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  const hasExisting = existingPriorities.length > 0 && !editing;
  const selectedCount = Object.keys(selectedRanks).length;

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight text-white mb-2">My Priorities</h1>
      <p className="text-zinc-400 mb-8">
        {hasExisting
          ? "Here are the issues you've ranked as most important."
          : "Select up to 5 issues in order of importance. Click to rank, click again to remove."}
      </p>

      {success && !editing && (
        <div className="mb-6 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-400 flex items-center gap-2">
          <Check className="w-4 h-4" />
          Priorities saved! Your voice has been counted.
        </div>
      )}

      {submitError && (
        <div className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          {submitError}
        </div>
      )}

      {hasExisting ? (
        <>
          <div className="space-y-3 mb-8">
            {existingPriorities
              .sort((a: any, b: any) => a.priority_rank - b.priority_rank)
              .map((p: any) => {
                const cat = categories.find(c => c.id === p.issue_category_id);
                return (
                  <div key={p.issue_category_id} className="flex items-center gap-4 p-4 rounded-xl border border-zinc-800 bg-zinc-900/50">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-sm font-bold">
                      #{p.priority_rank}
                    </div>
                    <CategoryIcon icon={cat?.icon || ""} name={cat?.name || p.category_name || "?"} />
                    <div>
                      <div className="text-white font-medium">{cat?.name || p.category_name}</div>
                      <div className="text-xs text-zinc-500">{cat?.description || ""}</div>
                    </div>
                  </div>
                );
              })}
          </div>
          <button
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-2 px-4 py-2 border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-600 rounded-lg transition-colors"
          >
            <Edit2 className="w-4 h-4" />
            Edit Priorities
          </button>
        </>
      ) : (
        <>
          <div className="text-sm text-zinc-500 mb-4">
            {selectedCount}/5 selected {selectedCount >= 5 && "(max reached)"}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-8">
            {categories.map(cat => {
              const rank = selectedRanks[cat.id];
              const isSelected = !!rank;
              return (
                <button
                  key={cat.id}
                  onClick={() => toggleCategory(cat.id)}
                  className={`relative p-4 rounded-xl border text-left transition-all ${
                    isSelected
                      ? "border-indigo-500/50 bg-indigo-500/10 ring-1 ring-indigo-500/30"
                      : selectedCount >= 5
                      ? "border-zinc-800 bg-zinc-900/30 opacity-40 cursor-not-allowed"
                      : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-900"
                  }`}
                  disabled={!isSelected && selectedCount >= 5}
                >
                  {isSelected && (
                    <div className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center shadow-lg">
                      {rank}
                    </div>
                  )}
                  <CategoryIcon icon={cat.icon} name={cat.name} />
                  <div className="mt-3 text-sm font-medium text-white">{cat.name}</div>
                  <div className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{cat.description}</div>
                </button>
              );
            })}
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleSubmit}
              disabled={selectedCount === 0 || submitting}
              className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
            >
              {submitting ? "Saving..." : `Save ${selectedCount} Priorities`}
            </button>
            {editing && (
              <button
                onClick={() => { setEditing(false); setSuccess(false); }}
                className="px-4 py-3 text-zinc-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
