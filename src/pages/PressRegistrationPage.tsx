import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, Check, Newspaper, AlertCircle, Clock, ExternalLink, Plus, Trash2 } from "lucide-react";
import * as api from "../api";
import { useAuth } from "../stores/auth";

export function PressRegistrationPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [credential, setCredential] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [sources, setSources] = useState<any[]>([]);
  const [sourceError, setSourceError] = useState("");
  const [sourceSubmitting, setSourceSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    outlet_name: "",
    outlet_type: "digital" as string,
    proof_url: "",
  });
  const [sourceForm, setSourceForm] = useState({
    name: "",
    url: "",
    description: "",
  });

  useEffect(() => {
    if (!user) { navigate("/login"); return; }
    Promise.all([
      api.getPressStatus(),
      api.getPressSources(),
    ])
      .then(([status, sourceData]) => {
        setCredential(status.credential);
        setSources(sourceData.sources || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await api.registerPress({
        outlet_name: formData.outlet_name,
        outlet_type: formData.outlet_type,
        proof_url: formData.proof_url || undefined,
      });
      // Re-fetch status
      const data = await api.getPressStatus();
      setCredential(data.credential);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  const reloadSources = async () => {
    const data = await api.getPressSources();
    setSources(data.sources || []);
  };

  const handleSourceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSourceSubmitting(true);
    setSourceError("");
    try {
      await api.addPressSource({
        name: sourceForm.name,
        url: sourceForm.url,
        description: sourceForm.description || undefined,
      });
      setSourceForm({ name: "", url: "", description: "" });
      await reloadSources();
    } catch (err: any) {
      setSourceError(err.response?.data?.error || err.message || "Failed to add source");
    } finally {
      setSourceSubmitting(false);
    }
  };

  const handleRemoveSource = async (id: string) => {
    setSourceError("");
    try {
      await api.removePressSource(id);
      await reloadSources();
    } catch (err: any) {
      setSourceError(err.response?.data?.error || err.message || "Failed to remove source");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <button
        type="button"
        onClick={() => navigate("/")}
        className="mb-6 inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Arenas
      </button>

      <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Press Credentials</h1>
      <p className="text-zinc-400 mb-8">
        Register as a credentialed press member to submit and vote on press questions.
      </p>

      {/* Status display */}
      {credential?.status === "approved" && (
        <div className="mb-8 p-6 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <Check className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <div className="text-lg font-semibold text-emerald-400">Verified Press</div>
              <div className="text-sm text-zinc-400">Your credentials have been approved.</div>
            </div>
          </div>
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-500">Outlet</span>
              <span className="text-white">{credential.outlet_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Type</span>
              <span className="text-white capitalize">{credential.outlet_type}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Approved</span>
              <span className="text-white">{credential.reviewed_at ? new Date(credential.reviewed_at).toLocaleDateString() : "—"}</span>
            </div>
          </div>
        </div>
      )}

      {credential?.status === "pending" && (
        <div className="mb-8 p-6 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <div className="flex items-center gap-3">
            <Clock className="w-6 h-6 text-amber-400" />
            <div>
              <div className="text-lg font-semibold text-amber-400">Application Pending</div>
              <div className="text-sm text-zinc-400">
                Your credentials for <span className="text-white">{credential.outlet_name}</span> ({credential.outlet_type}) are being reviewed.
              </div>
            </div>
          </div>
        </div>
      )}

      {credential?.status === "rejected" && (
        <div className="mb-8 p-6 rounded-xl bg-red-500/10 border border-red-500/20">
          <div className="flex items-center gap-3 mb-3">
            <AlertCircle className="w-6 h-6 text-red-400" />
            <div>
              <div className="text-lg font-semibold text-red-400">Application Rejected</div>
              <div className="text-sm text-zinc-400">Your previous application was not approved. You may re-apply below.</div>
            </div>
          </div>
        </div>
      )}

      {/* Form — show if no credential or rejected */}
      {(!credential || credential.status === "rejected") && (
        <>
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1.5">News Outlet Name</label>
              <input
                required
                type="text"
                maxLength={200}
                placeholder="e.g. The Washington Post, CNN, Your Local Paper"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                value={formData.outlet_name}
                onChange={e => setFormData({ ...formData, outlet_name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1.5">Outlet Type</label>
              <select
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                value={formData.outlet_type}
                onChange={e => setFormData({ ...formData, outlet_type: e.target.value })}
              >
                <option value="newspaper">Newspaper</option>
                <option value="tv">Television</option>
                <option value="radio">Radio</option>
                <option value="digital">Digital / Online</option>
                <option value="freelance">Freelance Journalist</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1.5">Proof URL (optional)</label>
              <input
                type="url"
                placeholder="Link to your author page, press badge, or outlet's staff directory"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                value={formData.proof_url}
                onChange={e => setFormData({ ...formData, proof_url: e.target.value })}
              />
              <p className="text-xs text-zinc-500 mt-1">Helps speed up verification.</p>
            </div>
            <button
              type="submit"
              disabled={submitting || !formData.outlet_name}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 text-white rounded-lg font-medium transition-colors"
            >
              {submitting ? "Submitting..." : credential?.status === "rejected" ? "Re-Apply for Credentials" : "Apply for Press Credentials"}
            </button>
          </form>
        </>
      )}

      <section className="mt-12 pt-8 border-t border-zinc-800">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="text-xl font-semibold text-white">Tracked News Sources</h2>
            <p className="text-sm text-zinc-500 mt-1">Preloaded politics links plus your own source list.</p>
          </div>
          <Newspaper className="w-5 h-5 text-indigo-400 mt-1" />
        </div>

        {sourceError && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
            {sourceError}
          </div>
        )}

        <div className="space-y-3 mb-6">
          {sources.map(source => (
            <div key={source.id} className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="font-medium text-white truncate">{source.name}</div>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                      source.is_default
                        ? "border-indigo-500/30 bg-indigo-500/10 text-indigo-300"
                        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    }`}>
                      {source.is_default ? "Preloaded" : "Yours"}
                    </span>
                  </div>
                  {source.description && (
                    <div className="text-sm text-zinc-400 mb-2">{source.description}</div>
                  )}
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex max-w-full items-center gap-1 text-sm text-indigo-300 hover:text-indigo-200"
                  >
                    <span className="truncate">{source.url}</span>
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  </a>
                </div>
                {!source.is_default && (
                  <button
                    type="button"
                    onClick={() => handleRemoveSource(source.id)}
                    className="shrink-0 rounded-lg border border-zinc-800 p-2 text-zinc-500 hover:border-red-500/40 hover:text-red-400 transition-colors"
                    aria-label={`Remove ${source.name}`}
                    title={`Remove ${source.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <form onSubmit={handleSourceSubmit} className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1.5">Source Name</label>
              <input
                required
                type="text"
                maxLength={200}
                placeholder="Local politics desk"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                value={sourceForm.name}
                onChange={e => setSourceForm({ ...sourceForm, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1.5">Source URL</label>
              <input
                required
                type="url"
                maxLength={1000}
                placeholder="https://newsroom.example/politics"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                value={sourceForm.url}
                onChange={e => setSourceForm({ ...sourceForm, url: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">Note</label>
            <input
              type="text"
              maxLength={500}
              placeholder="Statehouse, local races, campaign finance"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
              value={sourceForm.description}
              onChange={e => setSourceForm({ ...sourceForm, description: e.target.value })}
            />
          </div>
          <button
            type="submit"
            disabled={sourceSubmitting || !sourceForm.name || !sourceForm.url}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:bg-indigo-600/50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            {sourceSubmitting ? "Adding..." : "Add Source"}
          </button>
        </form>
      </section>
    </div>
  );
}
