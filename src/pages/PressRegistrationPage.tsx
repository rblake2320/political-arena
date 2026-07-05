import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { Check, Newspaper, AlertCircle, Clock, ExternalLink, Search } from "lucide-react";
import * as api from "../api";
import { useAuth } from "../stores/auth";

const lookupTargets = [
  { id: "web", label: "Web", build: (q: string) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}` },
  { id: "fec", label: "FEC", build: (q: string) => `https://www.fec.gov/data/?search=${encodeURIComponent(q)}` },
  { id: "congress", label: "Congress.gov", build: (q: string) => `https://www.congress.gov/search?q=${encodeURIComponent(q)}` },
  { id: "federal-register", label: "Federal Register", build: (q: string) => `https://www.federalregister.gov/documents/search?conditions%5Bterm%5D=${encodeURIComponent(q)}` },
  { id: "courtlistener", label: "CourtListener", build: (q: string) => `https://www.courtlistener.com/?q=${encodeURIComponent(q)}` },
];

function formatFeedDate(value?: string) {
  if (!value) return "Date pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function lookupUrlFor(input: string, targetId: string) {
  const value = input.trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(value)) return `https://${value}`;
  const target = lookupTargets.find(option => option.id === targetId) || lookupTargets[0];
  return target.build(value);
}

export function PressRegistrationPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [credential, setCredential] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedItems, setFeedItems] = useState<api.PressFeedItem[]>([]);
  const [lookupText, setLookupText] = useState("");
  const [lookupTarget, setLookupTarget] = useState(lookupTargets[0].id);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState({
    outlet_name: "",
    outlet_type: "digital" as string,
    proof_url: "",
  });

  useEffect(() => {
    api.getPressFeed({ limit: 8 })
      .then(data => setFeedItems(data.items))
      .catch(() => setFeedItems([]))
      .finally(() => setFeedLoading(false));
  }, []);

  useEffect(() => {
    if (!user) {
      setCredential(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    api.getPressStatus()
      .then(data => setCredential(data.credential))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  const handleLookup = (e: React.FormEvent) => {
    e.preventDefault();
    const value = lookupText.trim();
    if (!value) return;
    window.open(lookupUrlFor(value, lookupTarget), "_blank", "noopener,noreferrer");
  };

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

  if (loading && user) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Press</h1>
      <p className="text-zinc-400 mb-8">
        Track public political coverage and register as credentialed press to submit and vote on press questions.
      </p>

      <section className="mb-10 rounded-xl border border-zinc-800 bg-zinc-950/70 overflow-hidden">
        <div className="flex items-center justify-between gap-4 border-b border-zinc-800 px-5 py-4">
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-indigo-300">Public press wire</div>
            <h2 className="text-lg font-semibold text-white mt-1">Politics and oversight updates</h2>
          </div>
          <Newspaper className="w-5 h-5 text-zinc-500" />
        </div>
        {feedLoading ? (
          <div className="p-5 text-sm text-zinc-500">Loading press feed...</div>
        ) : feedItems.length === 0 ? (
          <div className="p-5 text-sm text-zinc-500">No press updates loaded yet.</div>
        ) : (
          <div className="divide-y divide-zinc-900">
            {feedItems.map(item => (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="group flex items-start justify-between gap-4 px-5 py-4 hover:bg-zinc-900/70 transition-colors"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-zinc-500 mb-1.5">
                    <span>{item.publisher}</span>
                    {item.section && <span className="text-zinc-700">/</span>}
                    {item.section && <span>{item.section}</span>}
                    <span className="text-zinc-700">/</span>
                    <span className={item.change_status === "updated" ? "text-amber-300" : "text-emerald-300"}>
                      {item.change_status}
                    </span>
                  </div>
                  <div className="text-sm font-medium text-zinc-100 group-hover:text-white">{item.title}</div>
                  <div className="text-xs text-zinc-500 mt-1">{formatFeedDate(item.published_at || item.first_seen_at)}</div>
                </div>
                <ExternalLink className="w-4 h-4 text-zinc-600 group-hover:text-indigo-300 flex-shrink-0 mt-1" />
              </a>
            ))}
          </div>
        )}
      </section>

      <section className="mb-10 rounded-xl border border-zinc-800 bg-zinc-950/70 p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
            <Search className="w-4 h-4 text-indigo-300" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-indigo-300">Source lookup</div>
            <h2 className="text-lg font-semibold text-white mt-1">Check another source</h2>
          </div>
        </div>
        <form onSubmit={handleLookup} className="grid grid-cols-1 md:grid-cols-[1fr_190px_auto] gap-3">
          <input
            type="text"
            value={lookupText}
            onChange={e => setLookupText(e.target.value)}
            placeholder="Paste a URL or search a claim, candidate, bill, filing"
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
          />
          <select
            value={lookupTarget}
            onChange={e => setLookupTarget(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
          >
            {lookupTargets.map(target => (
              <option key={target.id} value={target.id}>{target.label}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!lookupText.trim()}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Look up
          </button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {lookupTargets.slice(1).map(target => (
            <button
              key={target.id}
              type="button"
              onClick={() => setLookupTarget(target.id)}
              className={`px-2.5 py-1.5 rounded-md border text-xs transition-colors ${lookupTarget === target.id ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-200" : "border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"}`}
            >
              {target.label}
            </button>
          ))}
        </div>
      </section>

      <div className="max-w-xl">

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
      {!user && (
        <div className="p-6 rounded-xl bg-zinc-950 border border-zinc-800">
          <div className="text-lg font-semibold text-white mb-2">Press Credentials</div>
          <p className="text-sm text-zinc-400 mb-4">
            Sign in to apply for press credentials and submit press questions.
          </p>
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Sign in to apply
          </button>
        </div>
      )}

      {user && (!credential || credential.status === "rejected") && (
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
      </div>
    </div>
  );
}
