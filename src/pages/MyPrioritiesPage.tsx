import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { Check, Edit2, Plus, X } from "lucide-react";
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
  "vote": "bg-sky-500",
  "stethoscope": "bg-teal-500",
  "wallet": "bg-lime-500",
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
  const [existingWriteIns, setExistingWriteIns] = useState<any[]>([]);
  const [selectedRanks, setSelectedRanks] = useState<Record<string, number>>({});
  const [writeIns, setWriteIns] = useState<string[]>([]);
  const [writeInDraft, setWriteInDraft] = useState("");
  const [writeInError, setWriteInError] = useState("");
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
      const savedWriteIns = priData.write_ins || [];
      setExistingPriorities(existing);
      setExistingWriteIns(savedWriteIns);
      setWriteIns(savedWriteIns.map((writeIn: any) => writeIn.writein_text));
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

  const addWriteIn = () => {
    const trimmed = writeInDraft.trim().replace(/\s+/g, " ");
    const normalized = trimmed.toLowerCase();
    setWriteInError("");

    if (!trimmed) return;
    if (trimmed.length < 3 || trimmed.length > 200) {
      setWriteInError("Write-ins must be 3 to 200 characters.");
      return;
    }
    if (writeIns.length >= 3) {
      setWriteInError("You can add up to 3 write-in issues.");
      return;
    }
    if (writeIns.some(item => item.toLowerCase() === normalized)) {
      setWriteInError("That write-in is already listed.");
      return;
    }

    setWriteIns(prev => [...prev, trimmed]);
    setWriteInDraft("");
  };

  const removeWriteIn = (index: number) => {
    setWriteIns(prev => prev.filter((_, i) => i !== index));
    setWriteInError("");
  };

  const handleSubmit = async () => {
    const priorities = Object.entries(selectedRanks).map(([catId, rank]) => ({
      issue_category_id: catId,
      priority_rank: rank,
    }));
    if (priorities.length === 0) return;
    const cleanedWriteIns = writeIns.map(item => item.trim().replace(/\s+/g, " ")).filter(Boolean);
    setSubmitting(true);
    setSubmitError("");
    try {
      await api.submitPriorities({ priorities, write_ins: cleanedWriteIns });
      setSuccess(true);
      setExistingPriorities(priorities.map(p => ({
        ...p,
        category_name: categories.find(c => c.id === p.issue_category_id)?.name,
        icon: categories.find(c => c.id === p.issue_category_id)?.icon,
      })));
      setExistingWriteIns(cleanedWriteIns.map((writein_text, index) => ({
        id: `local-${index}`,
        writein_text,
      })));
      setWriteIns(cleanedWriteIns);
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
          {existingWriteIns.length > 0 && (
            <div className="mb-8 border-t border-zinc-800 pt-5">
              <div className="text-sm font-medium text-zinc-300 mb-3">Write-in issues</div>
              <div className="flex flex-wrap gap-2">
                {existingWriteIns.map((writeIn: any) => (
                  <span key={writeIn.id || writeIn.writein_text} className="px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-950 text-sm text-zinc-300">
                    {writeIn.writein_text}
                  </span>
                ))}
              </div>
            </div>
          )}
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

          <div className="mb-8 border-t border-zinc-800 pt-6">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <div className="text-sm font-medium text-zinc-300">Write-in issues</div>
                <div className="text-xs text-zinc-500">Optional, secondary to the ranked categories.</div>
              </div>
              <div className="text-xs text-zinc-500">{writeIns.length}/3</div>
            </div>

            {writeIns.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {writeIns.map((item, index) => (
                  <span key={`${item}-${index}`} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-950 text-sm text-zinc-300">
                    {item}
                    <button
                      type="button"
                      onClick={() => removeWriteIn(index)}
                      className="text-zinc-500 hover:text-white"
                      aria-label={`Remove ${item}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <input
                value={writeInDraft}
                onChange={event => {
                  setWriteInDraft(event.target.value);
                  setWriteInError("");
                }}
                onKeyDown={event => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addWriteIn();
                  }
                }}
                maxLength={200}
                disabled={writeIns.length >= 3}
                className="min-w-0 flex-1 px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                placeholder="Add an issue not listed"
              />
              <button
                type="button"
                onClick={addWriteIn}
                disabled={writeIns.length >= 3 || writeInDraft.trim().length === 0}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm text-white transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </div>
            {writeInError && <div className="mt-2 text-xs text-red-400">{writeInError}</div>}
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
