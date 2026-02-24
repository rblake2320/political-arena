import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { Check, Newspaper, AlertCircle, Clock } from "lucide-react";
import * as api from "../api";
import { useAuth } from "../stores/auth";

export function PressRegistrationPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [credential, setCredential] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState({
    outlet_name: "",
    outlet_type: "digital" as string,
    proof_url: "",
  });

  useEffect(() => {
    if (!user) { navigate("/login"); return; }
    api.getPressStatus()
      .then(data => setCredential(data.credential))
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-12">
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
    </div>
  );
}
