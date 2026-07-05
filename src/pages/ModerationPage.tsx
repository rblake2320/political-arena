import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router";
import { AlertCircle, ExternalLink, FileCheck2, ShieldCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import * as api from "../api";
import { useAuth } from "../stores/auth";

function contentLink(recite: any) {
  if (recite.content_type === "challenge" || recite.content_type === "challenge_response") {
    return `/challenge/${recite.content_id}`;
  }
  return null;
}

export function ModerationPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState<"pending" | "verified" | "rejected">("pending");
  const [recites, setRecites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const canModerate = Boolean(user && ["moderator", "admin", "super_admin"].includes(user.role));

  const refresh = () => {
    setLoading(true);
    setError("");
    api.getPendingRecites({ status })
      .then(data => setRecites(data.recites || []))
      .catch((err: any) => {
        setError(err.response?.data?.error || err.message || "Failed to load recites");
        setRecites([]);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (canModerate) refresh();
  }, [status, canModerate]);

  const review = async (id: string, nextStatus: "pending" | "verified" | "rejected") => {
    setReviewingId(id);
    setError("");
    try {
      await api.reviewRecite(id, nextStatus, notes[id] || undefined);
      refresh();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || "Review failed");
    } finally {
      setReviewingId(null);
    }
  };

  if (!user) return <Navigate to="/login" replace />;
  if (!canModerate) {
    return (
      <div className="max-w-xl mx-auto px-4 py-24 text-center">
        <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
        <h1 className="text-2xl font-semibold text-white mb-2">Access denied</h1>
        <p className="text-zinc-400">Only moderators and admins can review recites.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-2 text-sm text-indigo-300">
          <ShieldCheck className="w-4 h-4" />
          Moderation
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Recite Review Queue</h1>
        <p className="mt-2 text-zinc-400">Verify, reject, or return recites to pending status. Verified recites carry more score confidence.</p>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {(["pending", "verified", "rejected"] as const).map(item => (
          <button
            key={item}
            onClick={() => setStatus(item)}
            className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
              status === item
                ? "border-indigo-500/30 bg-indigo-500/15 text-indigo-200"
                : "border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-white"
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
        </div>
      ) : recites.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-12 text-center text-zinc-500">
          No {status} recites.
        </div>
      ) : (
        <div className="space-y-4">
          {recites.map(recite => {
            const link = contentLink(recite);
            return (
              <div key={recite.id} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                <div className="mb-3 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider">
                  <span className="rounded-full border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-zinc-300">{recite.content_type}</span>
                  <span className="rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2 py-0.5 text-indigo-300">{recite.source_type}</span>
                  <span className="rounded-full border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-zinc-300">{recite.stance}</span>
                  <span className="text-zinc-600">
                    {recite.created_at ? formatDistanceToNow(new Date(recite.created_at), { addSuffix: true }) : ""}
                  </span>
                </div>

                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-start gap-2">
                      <FileCheck2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-indigo-300" />
                      <a href={recite.url} target="_blank" rel="noreferrer" className="font-semibold text-white hover:text-indigo-200 break-words">
                        {recite.title}
                      </a>
                      <ExternalLink className="mt-1 h-3.5 w-3.5 flex-shrink-0 text-zinc-500" />
                    </div>
                    {recite.publisher && <div className="text-sm text-zinc-500">{recite.publisher}</div>}
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
                    {link && (
                      <Link to={link} className="mt-3 inline-block text-xs text-indigo-300 hover:text-indigo-200">
                        Open public receipt
                      </Link>
                    )}
                  </div>

                  <div className="w-full md:w-64">
                    <textarea
                      rows={3}
                      maxLength={1000}
                      placeholder="Review note"
                      className="mb-2 w-full resize-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      value={notes[recite.id] || ""}
                      onChange={e => setNotes({ ...notes, [recite.id]: e.target.value })}
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => review(recite.id, "verified")}
                        disabled={reviewingId === recite.id || recite.status === "verified"}
                        className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                      >
                        Verify
                      </button>
                      <button
                        onClick={() => review(recite.id, "rejected")}
                        disabled={reviewingId === recite.id || recite.status === "rejected"}
                        className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => review(recite.id, "pending")}
                        disabled={reviewingId === recite.id || recite.status === "pending"}
                        className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
                      >
                        Pending
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
