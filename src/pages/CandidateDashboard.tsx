import React, { useState, useEffect } from "react";
import { useParams } from "react-router";
import { BarChart3, Plus, ShieldAlert, Video, MessageSquareWarning, X, TrendingUp, Clock, Eye, Coins, FileText, ExternalLink } from "lucide-react";
import { useArenaStore } from "../store";
import * as api from "../api";
import { useAuth } from "../stores/auth";
import { ContentMedia, MediaUploadField } from "../components/Media";

export function CandidateDashboard() {
  const { id } = useParams();
  const [activeTab, setActiveTab] = useState("overview");
  const [isCreateAdModalOpen, setIsCreateAdModalOpen] = useState(false);
  const [isCreateStatementModalOpen, setIsCreateStatementModalOpen] = useState(false);
  const [respondingToChallenge, setRespondingToChallenge] = useState<any>(null);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [candidateStatements, setCandidateStatements] = useState<any[]>([]);
  const [statementsLoading, setStatementsLoading] = useState(false);
  const [statementsError, setStatementsError] = useState("");
  const { user } = useAuth();

  const { raceDetails, fetchRace, allCandidates, loading } = useArenaStore();

  // Find candidate across all race details
  const candidate = allCandidates.find(c => c.id === id);
  const raceData = candidate ? raceDetails[candidate.race_id] : null;

  useEffect(() => {
    if (candidate?.race_id) {
      fetchRace(candidate.race_id);
    }
  }, [candidate?.race_id]);

  useEffect(() => {
    if (id && user) {
      api.getCreditBalance(id).then(data => setCreditBalance(data.credit_balance)).catch(() => {});
    }
  }, [id, user]);

  useEffect(() => {
    if (!id) return;
    setStatementsLoading(true);
    setStatementsError("");
    api.getCandidateStatements(id)
      .then(data => setCandidateStatements(data.statements || []))
      .catch((err: any) => {
        setCandidateStatements([]);
        setStatementsError(err.response?.data?.error || err.message || "Failed to load statements");
      })
      .finally(() => setStatementsLoading(false));
  }, [id]);

  if (loading && !raceData) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  // Bug #6 fix: show spinner when data hasn't loaded yet instead of "not found"
  if (!candidate && allCandidates.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }
  if (!candidate) return <div className="p-12 text-center text-zinc-500">Candidate not found.</div>;
  const hasCampaignAccess = Boolean(user?.staff_links?.some((link: any) => link.candidate_id === candidate.id));
  if (!hasCampaignAccess) {
    return (
      <div className="max-w-xl mx-auto px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold text-white mb-2">Campaign access required</h1>
        <p className="text-zinc-400">
          Candidate portals are limited to users with an active staff link for that campaign. Platform admin and moderation tools are separate from campaign authority.
        </p>
      </div>
    );
  }
  if (!raceData) return <div className="p-12 text-center text-zinc-500">Race data not found.</div>;

  const candidateAds = raceData.ads.filter(ad => ad.candidate_id === candidate.id && ad.source_type !== 'external');
  const candidateChallenges = raceData.challenges.filter(
    c => c.challenger_candidate_id === candidate.id || c.target_candidate_id === candidate.id,
  );
  const candidateRebuttals = raceData.rebuttals.filter(r => r.candidate_id === candidate.id);

  const refreshRace = () => {
    if (candidate?.race_id) fetchRace(candidate.race_id);
  };
  const refreshStatements = () => {
    if (!candidate?.id) return;
    setStatementsLoading(true);
    setStatementsError("");
    api.getCandidateStatements(candidate.id)
      .then(data => setCandidateStatements(data.statements || []))
      .catch((err: any) => {
        setCandidateStatements([]);
        setStatementsError(err.response?.data?.error || err.message || "Failed to load statements");
      })
      .finally(() => setStatementsLoading(false));
  };

  const tabTitles: Record<string, string> = {
    overview: "Dashboard Overview",
    ads: "Ad Flights",
    challenges: "Challenges",
    rebuttals: "Rebuttals",
    statements: "Statement Ledger",
  };

  return (
    <div className="flex flex-col md:flex-row min-h-[calc(100vh-64px)]">
      {/* Sidebar */}
      <aside className="w-full md:w-64 border-b md:border-b-0 md:border-r border-zinc-800 bg-zinc-950/50 p-4 md:p-6 flex md:flex-col gap-2 overflow-x-auto md:overflow-x-visible">
        <div className="hidden md:block mb-8">
          <div className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">Candidate Portal</div>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white ${
              candidate.party === "Democrat" ? "bg-blue-600" : candidate.party === "Republican" ? "bg-red-600" : "bg-indigo-600"
            }`}>
              {candidate.name.charAt(0)}
            </div>
            <div>
              <div className="font-medium text-white">{candidate.name}</div>
              <div className="text-xs text-zinc-400">{raceData.office} - {candidate.race_state}</div>
            </div>
          </div>
        </div>

        <NavItem icon={<BarChart3 className="w-4 h-4" />} label="Overview" active={activeTab === "overview"} onClick={() => setActiveTab("overview")} />
        <NavItem icon={<Video className="w-4 h-4" />} label="Ad Flights" active={activeTab === "ads"} onClick={() => setActiveTab("ads")} />
        <NavItem icon={<MessageSquareWarning className="w-4 h-4" />} label="Challenges" active={activeTab === "challenges"} onClick={() => setActiveTab("challenges")} />
        <NavItem icon={<ShieldAlert className="w-4 h-4" />} label="Rebuttals" active={activeTab === "rebuttals"} onClick={() => setActiveTab("rebuttals")} />
        <NavItem icon={<FileText className="w-4 h-4" />} label="Statements" active={activeTab === "statements"} onClick={() => setActiveTab("statements")} />
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-8">
        <div className="max-w-4xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">{tabTitles[activeTab]}</h1>
            <div className="flex gap-3">
              {activeTab === "ads" && (
                <button
                  onClick={() => setIsCreateAdModalOpen(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors text-sm"
                >
                  <Plus className="w-4 h-4" />
                  New Ad Flight
                </button>
              )}
              {activeTab === "statements" && (
                <button
                  onClick={() => setIsCreateStatementModalOpen(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors text-sm"
                >
                  <Plus className="w-4 h-4" />
                  Log Statement
                </button>
              )}
            </div>
          </div>

          {/* Overview Tab */}
          {activeTab === "overview" && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 md:gap-6 mb-12">
                <StatCard icon={<Eye className="w-5 h-5 text-indigo-400" />} label="Active Ads" value={String(candidateAds.filter(a => a.status === 'active').length)} />
                <StatCard icon={<TrendingUp className="w-5 h-5 text-emerald-400" />} label="Rebuttals" value={String(candidateRebuttals.length)} />
                <StatCard icon={<Clock className="w-5 h-5 text-amber-400" />} label="Open Challenges" value={String(candidateChallenges.filter(c => c.status === "open").length)} trend="urgent" />
                <StatCard icon={<FileText className="w-5 h-5 text-sky-400" />} label="Statements" value={String(candidateStatements.length)} />
                <StatCard icon={<Coins className="w-5 h-5 text-yellow-400" />} label="Credits" value={creditBalance !== null ? String(creditBalance) : "—"} trend={creditBalance !== null && creditBalance <= 2 ? "low" : undefined} />
              </div>

              <h2 className="text-xl font-semibold mb-6">Recent Activity</h2>
              <div className="space-y-4">
                {candidateChallenges.filter(c => c.status === "open").map(c => {
                  const isTarget = c.target_candidate_id === candidate.id;
                  const otherName = raceData.candidates.find(
                    cand => cand.id === (isTarget ? c.challenger_candidate_id : c.target_candidate_id),
                  )?.name || "Unknown";
                  return (
                    <ActivityItem
                      key={c.id}
                      type="challenge"
                      title={isTarget ? `Challenge from ${otherName}` : `Challenge to ${otherName}`}
                      time="Active"
                      status={isTarget ? "Needs Response" : "Awaiting"}
                      urgent={isTarget}
                    />
                  );
                })}
                {candidateAds.map(ad => (
                  <ActivityItem
                    key={ad.id}
                    type="ad"
                    title={ad.title || 'Ad Flight'}
                    time={ad.status}
                    status={ad.status === "active" ? "Running" : ad.status}
                  />
                ))}
                {candidateRebuttals.map(r => (
                  <ActivityItem
                    key={r.id}
                    type="rebuttal"
                    title="Rebuttal Published"
                    time={r.status}
                    status="Active"
                  />
                ))}
                {candidateChallenges.length === 0 && candidateAds.length === 0 && candidateRebuttals.length === 0 && (
                  <div className="p-8 text-center text-zinc-500 border border-zinc-800 rounded-xl">No recent activity.</div>
                )}
              </div>
            </>
          )}

          {/* Ads Tab */}
          {activeTab === "ads" && (
            <div className="space-y-6">
              {candidateAds.length === 0 ? (
                <EmptyState title="No Ad Flights" description="You haven't created any ad flights yet." />
              ) : (
                candidateAds.map(ad => (
                  <div key={ad.id} className="p-4 md:p-6 rounded-2xl border border-zinc-800 bg-zinc-900/50">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-sm font-medium text-white">{ad.title || 'Ad Flight'}</div>
                      <span className="px-2 py-1 rounded text-[10px] font-medium uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        {ad.status}
                      </span>
                    </div>
                    {ad.ad_content_text && (
                      <p className="text-sm text-zinc-300 mb-3">{ad.ad_content_text}</p>
                    )}
                    {ad.media_url && (
                      <ContentMedia url={ad.media_url} mediaType={ad.media_type} alt="Ad media" />
                    )}
                    <div className="text-xs text-zinc-500 mb-3">
                      {ad.start_date ? new Date(ad.start_date).toLocaleDateString() : ''} - {ad.end_date ? new Date(ad.end_date).toLocaleDateString() : ''}
                    </div>
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider border border-zinc-800 p-2 rounded bg-zinc-950/50">
                      {ad.disclaimer_text}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Challenges Tab */}
          {activeTab === "challenges" && (
            <div className="space-y-6">
              {candidateChallenges.length === 0 ? (
                <EmptyState title="No Challenges" description="You haven't issued or received any challenges." />
              ) : (
                candidateChallenges.map(challenge => {
                  const isChallenger = challenge.challenger_candidate_id === candidate.id;
                  const otherCandidateId = isChallenger ? challenge.target_candidate_id : challenge.challenger_candidate_id;
                  const otherCandidate = raceData.candidates.find(c => c.id === otherCandidateId);

                  return (
                    <div key={challenge.id} className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/50">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2 text-sm">
                          {isChallenger ? (
                            <>
                              <span className="text-zinc-500">You challenged</span>
                              <span className="font-medium text-white">{otherCandidate?.name}</span>
                            </>
                          ) : (
                            <>
                              <span className="font-medium text-white">{otherCandidate?.name}</span>
                              <span className="text-zinc-500">challenged you</span>
                            </>
                          )}
                        </div>
                        <span className={`px-2 py-1 rounded text-[10px] font-medium uppercase tracking-wider ${
                          challenge.status === "open"
                            ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                            : challenge.status === "responded"
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : challenge.status === "expired"
                            ? "bg-red-500/10 text-red-400 border border-red-500/20"
                            : challenge.status === "refused"
                            ? "bg-orange-500/10 text-orange-400 border border-orange-500/20"
                            : "bg-zinc-800 text-zinc-400"
                        }`}>
                          {challenge.status === "expired" ? "NO RESPONSE" : challenge.status === "refused" ? "REFUSED" : challenge.status}
                        </span>
                      </div>
                      <div className="pl-4 border-l-2 border-indigo-500/30 py-2 mb-4">
                        <p className="text-sm text-zinc-200 font-serif italic">"{challenge.challenge_text}"</p>
                      </div>
                      {challenge.media_url && (
                        <ContentMedia url={challenge.media_url} alt="Challenge media" />
                      )}
                      {!isChallenger && challenge.status === "open" && (
                        <button
                          onClick={() => setRespondingToChallenge(challenge)}
                          className="text-sm font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
                        >
                          Respond to Challenge
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Rebuttals Tab */}
          {activeTab === "rebuttals" && (
            <div className="space-y-6">
              {candidateRebuttals.length === 0 ? (
                <EmptyState title="No Rebuttals" description="You haven't posted any rebuttals yet." />
              ) : (
                candidateRebuttals.map(rebuttal => (
                  <div key={rebuttal.id} className="p-4 md:p-6 rounded-2xl border border-zinc-800 bg-zinc-900/50">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-medium text-white">Rebuttal</div>
                      <span className="px-2 py-1 rounded text-[10px] font-medium uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        {rebuttal.status}
                      </span>
                    </div>
                    <p className="text-sm text-zinc-300 mb-4 italic">"{rebuttal.response_text}"</p>
                    {rebuttal.media_url && (
                      <ContentMedia url={rebuttal.media_url} alt="Rebuttal media" />
                    )}
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider border border-zinc-800 p-2 rounded bg-zinc-950/50">
                      {rebuttal.disclaimer_text}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Statements Tab */}
          {activeTab === "statements" && (
            <div className="space-y-6">
              {statementsError && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {statementsError}
                </div>
              )}
              {statementsLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                </div>
              ) : candidateStatements.length === 0 ? (
                <EmptyState title="No Statements Logged" description="Add sourced statements so voters can inspect the public record over time." />
              ) : (
                candidateStatements.map(statement => (
                  <div key={statement.id} className="p-4 md:p-6 rounded-2xl border border-zinc-800 bg-zinc-900/50">
                    <div className="mb-3 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider">
                      <span className="rounded-full border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-zinc-300">{statement.truth_status}</span>
                      <span className="rounded-full border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-zinc-300">{statement.answer_status}</span>
                      {statement.topic && <span className="rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2 py-0.5 text-indigo-300">{statement.topic}</span>}
                    </div>
                    <p className="text-sm leading-relaxed text-zinc-200">"{statement.statement_text}"</p>
                    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                      {statement.statement_at && <span>{new Date(statement.statement_at).toLocaleDateString()}</span>}
                      <span>{statement.source_type}</span>
                      <a href={statement.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-300 hover:text-indigo-200">
                        Source <ExternalLink className="w-3 h-3" />
                      </a>
                      {statement.transcript_url && (
                        <a href={statement.transcript_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-300 hover:text-indigo-200">
                          Transcript <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </main>

      {/* Modals */}
      {isCreateAdModalOpen && (
        <CreateAdModal
          onClose={(refresh) => {
            setIsCreateAdModalOpen(false);
            if (refresh) refreshRace();
          }}
          candidateId={candidate.id}
          raceId={candidate.race_id}
        />
      )}
      {respondingToChallenge && (
        <RespondChallengeModal
          challenge={respondingToChallenge}
          candidateId={candidate.id}
          onClose={(refresh) => {
            setRespondingToChallenge(null);
            if (refresh) refreshRace();
          }}
        />
      )}
      {isCreateStatementModalOpen && (
        <CreateStatementModal
          candidateId={candidate.id}
          raceId={candidate.race_id}
          onClose={(refresh) => {
            setIsCreateStatementModalOpen(false);
            if (refresh) refreshStatements();
          }}
        />
      )}
    </div>
  );
}

// ---- Helper Components ----

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap md:w-full text-left ${
        active
          ? "bg-indigo-500/10 text-indigo-400"
          : "text-zinc-400 hover:bg-zinc-900 hover:text-white"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function StatCard({ icon, label, value, trend }: { icon: React.ReactNode; label: string; value: string; trend?: string }) {
  return (
    <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/50">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <span className="text-sm font-medium text-zinc-400">{label}</span>
      </div>
      <div className="flex items-end justify-between">
        <div className="text-3xl font-bold text-white">{value}</div>
        {trend && (
          <div className={`text-xs font-medium px-2 py-1 rounded ${
            trend === "urgent" ? "bg-amber-500/10 text-amber-400" :
            trend === "low" ? "bg-red-500/10 text-red-400" :
            "bg-zinc-800 text-zinc-400"
          }`}>
            {trend}
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityItem({ type, title, time, status, urgent }: { type: string; title: string; time: string; status: string; urgent?: boolean }) {
  const icons: Record<string, React.ReactNode> = {
    challenge: <MessageSquareWarning className="w-5 h-5 text-amber-400" />,
    ad: <Video className="w-5 h-5 text-indigo-400" />,
    rebuttal: <ShieldAlert className="w-5 h-5 text-emerald-400" />,
  };

  return (
    <div className="flex items-center justify-between p-4 rounded-xl border border-zinc-800 bg-zinc-900/30 hover:bg-zinc-900/50 transition-colors">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-zinc-950 border border-zinc-800 flex items-center justify-center flex-shrink-0">
          {icons[type]}
        </div>
        <div>
          <div className="font-medium text-white text-sm">{title}</div>
          <div className="text-xs text-zinc-500">{time}</div>
        </div>
      </div>
      <div className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
        urgent
          ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
          : "bg-zinc-800 text-zinc-400 border-zinc-700"
      }`}>
        {status}
      </div>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="p-12 text-center border border-zinc-800 rounded-2xl bg-zinc-900/30">
      <div className="text-zinc-400 mb-2">{title}</div>
      <div className="text-sm text-zinc-500">{description}</div>
    </div>
  );
}

// ---- Modals ----

function CreateAdModal({ onClose, candidateId, raceId }: { onClose: (refresh?: boolean) => void; candidateId: string; raceId: string }) {
  const [formData, setFormData] = useState({ title: '', ad_content_text: '', disclaimer_text: '', media_url: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await api.createAd({
        ...formData,
        media_url: formData.media_url || undefined,
        candidate_id: candidateId,
        race_id: raceId,
      });
      onClose(true);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to create ad');
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title="New Ad Flight" onClose={() => onClose()}>
      {error && (
        <div className="mx-6 mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <InputField label="Ad Title" required placeholder="e.g. Healthcare for Alabama" value={formData.title} onChange={v => setFormData({ ...formData, title: v })} />
        <div>
          <label className="block text-sm font-medium text-zinc-400 mb-1.5">Ad Content</label>
          <textarea
            required
            rows={4}
            placeholder="Your ad message..."
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors resize-none"
            value={formData.ad_content_text}
            onChange={e => setFormData({ ...formData, ad_content_text: e.target.value })}
          />
        </div>
        <MediaUploadField candidateId={candidateId} onMediaUrl={url => setFormData({ ...formData, media_url: url })} label="Attach Ad Media (video, image, audio)" />
        <InputField label="FEC Disclaimer" required placeholder="Paid for by..." value={formData.disclaimer_text} onChange={v => setFormData({ ...formData, disclaimer_text: v })} />
        <ModalActions onCancel={() => onClose()} submitLabel={submitting ? 'Creating...' : 'Create Ad Flight'} disabled={submitting} />
      </form>
    </ModalShell>
  );
}

function RespondChallengeModal({ onClose, challenge, candidateId }: { onClose: (refresh?: boolean) => void; challenge: any; candidateId: string }) {
  const [formData, setFormData] = useState({ response_text: "", media_url: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await api.respondToChallenge(challenge.id, { response_text: formData.response_text, media_url: formData.media_url || undefined });
      onClose(true);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to respond');
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title="Respond to Challenge" onClose={() => onClose()}>
      <div className="p-4 bg-zinc-950/50 border-b border-zinc-800">
        <div className="text-xs text-zinc-500 mb-1">Original Challenge</div>
        <div className="text-sm text-zinc-300 italic">"{challenge.challenge_text}"</div>
      </div>
      {error && (
        <div className="mx-6 mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-zinc-400 mb-1.5">Response Text</label>
          <textarea
            required
            rows={4}
            placeholder="Type your response here..."
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors resize-none"
            value={formData.response_text}
            onChange={e => setFormData({ ...formData, response_text: e.target.value })}
          />
        </div>
        <MediaUploadField candidateId={candidateId} onMediaUrl={url => setFormData({ ...formData, media_url: url })} label="Attach Response Media (video, image, audio)" />
        <ModalActions onCancel={() => onClose()} submitLabel={submitting ? 'Submitting...' : 'Submit Response'} disabled={submitting} />
      </form>
    </ModalShell>
  );
}

function CreateStatementModal({ onClose, candidateId, raceId }: { onClose: (refresh?: boolean) => void; candidateId: string; raceId: string }) {
  const [formData, setFormData] = useState({
    statement_text: "",
    source_url: "",
    source_type: "article",
    source_title: "",
    topic: "",
    statement_at: "",
    transcript_url: "",
    context_text: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await api.createStatement({
        candidate_id: candidateId,
        race_id: raceId,
        statement_text: formData.statement_text,
        source_url: formData.source_url,
        source_type: formData.source_type as any,
        source_title: formData.source_title || undefined,
        topic: formData.topic || undefined,
        statement_at: formData.statement_at ? new Date(formData.statement_at).toISOString() : undefined,
        transcript_url: formData.transcript_url || undefined,
        context_text: formData.context_text || undefined,
      });
      onClose(true);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || "Failed to log statement");
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title="Log Public Statement" onClose={() => onClose()}>
      {error && (
        <div className="mx-6 mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-zinc-400 mb-1.5">Statement Text</label>
          <textarea
            required
            rows={4}
            maxLength={5000}
            placeholder="The exact public statement voters should be able to inspect..."
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors resize-none"
            value={formData.statement_text}
            onChange={e => setFormData({ ...formData, statement_text: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InputField label="Topic" placeholder="Healthcare, taxes, housing..." value={formData.topic} onChange={v => setFormData({ ...formData, topic: v })} />
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">Source Type</label>
            <select
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
              value={formData.source_type}
              onChange={e => setFormData({ ...formData, source_type: e.target.value })}
            >
              <option value="article">Article</option>
              <option value="youtube">YouTube</option>
              <option value="video">Video</option>
              <option value="audio">Audio</option>
              <option value="debate">Debate</option>
              <option value="social">Social</option>
              <option value="press_release">Press Release</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
        <InputField label="Source URL" required type="url" placeholder="https://..." value={formData.source_url} onChange={v => setFormData({ ...formData, source_url: v })} />
        <InputField label="Source Title" placeholder="Town hall answer, interview, article title..." value={formData.source_title} onChange={v => setFormData({ ...formData, source_title: v })} />
        <InputField label="Statement Time" type="datetime-local" value={formData.statement_at} onChange={v => setFormData({ ...formData, statement_at: v })} />
        <InputField label="Transcript URL" type="url" placeholder="https://..." value={formData.transcript_url} onChange={v => setFormData({ ...formData, transcript_url: v })} />
        <div>
          <label className="block text-sm font-medium text-zinc-400 mb-1.5">Context</label>
          <textarea
            rows={3}
            maxLength={5000}
            placeholder="Optional context around where or why the statement was made..."
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors resize-none"
            value={formData.context_text}
            onChange={e => setFormData({ ...formData, context_text: e.target.value })}
          />
        </div>
        <ModalActions onCancel={() => onClose()} submitLabel={submitting ? "Logging..." : "Log Statement"} disabled={submitting} />
      </form>
    </ModalShell>
  );
}

// ---- Shared Modal Parts ----

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white p-1 rounded-md hover:bg-zinc-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function InputField({
  label, required, type = "text", placeholder, value, onChange
}: {
  label: string; required?: boolean; type?: string; placeholder?: string; value: string; onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-zinc-400 mb-1.5">{label}</label>
      <input
        required={required}
        type={type}
        placeholder={placeholder}
        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}

function ModalActions({ onCancel, submitLabel, disabled }: { onCancel: () => void; submitLabel: string; disabled?: boolean }) {
  return (
    <div className="pt-4 flex justify-end gap-3">
      <button type="button" onClick={onCancel} className="px-4 py-2 text-sm font-medium text-zinc-300 hover:text-white transition-colors">
        Cancel
      </button>
      <button type="submit" disabled={disabled} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 text-white text-sm font-medium rounded-lg transition-colors">
        {submitLabel}
      </button>
    </div>
  );
}
