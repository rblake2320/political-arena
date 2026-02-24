import React, { useState, useContext, useEffect } from "react";
import { useParams } from "react-router";
import { Shield, ShieldAlert, AlertCircle, ThumbsUp, ThumbsDown, MessageSquare, Play, Plus, X, Upload, Clock, ArrowBigUp, HelpCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { CandidateContext } from "../App";
import { useArenaStore, type RaceDetail } from "../store";
import * as api from "../api";
import { useAuth } from "../stores/auth";

export function Race() {
  const { id } = useParams();
  const [activeTab, setActiveTab] = useState<"ads" | "challenges" | "questions">("ads");
  const { activeCandidateId } = useContext(CandidateContext);
  const [isIssueChallengeModalOpen, setIsIssueChallengeModalOpen] = useState(false);
  const [claimingRebuttalForAd, setClaimingRebuttalForAd] = useState<string | null>(null);
  const { user } = useAuth();

  const { raceDetails, fetchRace, loading } = useArenaStore();
  const raceData = raceDetails[id!] || null;

  useEffect(() => {
    if (id) fetchRace(id);
  }, [id]);

  if (loading && !raceData) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!raceData) return <div className="p-12 text-center text-zinc-500">Race not found.</div>;

  const isCandidateInRace = user && activeCandidateId && raceData.candidates.some(c => c.id === activeCandidateId);

  const refreshRace = () => {
    if (id) fetchRace(id);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <span className="px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-400 text-xs font-medium uppercase tracking-wider">
            {raceData.state} {raceData.office}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-zinc-400">
            <Shield className="w-3.5 h-3.5" /> Verified Voters Only
          </span>
        </div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-6">{raceData.name}</h1>

        {/* Candidates Overview */}
        <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4">
          {raceData.candidates.map(c => (
            <div key={c.id} className="flex-shrink-0 w-64 p-4 rounded-xl border border-zinc-800 bg-zinc-900/30">
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white ${
                  c.party === "Democrat" ? "bg-blue-600" : c.party === "Republican" ? "bg-red-600" : "bg-zinc-700"
                }`}>
                  {c.name.charAt(0)}
                </div>
                <div>
                  <div className="font-medium text-white">{c.name}</div>
                  <div className="text-xs text-zinc-400">{c.party}</div>
                </div>
              </div>
              <div className="text-xs text-zinc-500 line-clamp-2">{c.biography}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-6 border-b border-zinc-800 mb-8">
        <button
          onClick={() => setActiveTab("ads")}
          className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "ads"
              ? "border-indigo-500 text-white"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Ads & Rebuttals ({raceData.ads.length})
        </button>
        <button
          onClick={() => setActiveTab("challenges")}
          className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "challenges"
              ? "border-indigo-500 text-white"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Challenges ({raceData.challenges.length})
        </button>
        <button
          onClick={() => setActiveTab("questions")}
          className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "questions"
              ? "border-indigo-500 text-white"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <span className="flex items-center gap-1.5">
            <HelpCircle className="w-3.5 h-3.5" />
            Questions
          </span>
        </button>
      </div>

      {/* Ads Tab */}
      {activeTab === "ads" && (
        <div className="space-y-8">
          {raceData.ads.length === 0 ? (
            <EmptyState title="No ads yet" description="Be the first to run an ad in this race." />
          ) : (
            raceData.ads.map(ad => {
              const candidate = raceData.candidates.find(c => c.id === ad.candidate_id);
              const rebuttal = raceData.rebuttals.find(r => r.parent_ad_id === ad.id);
              const rebuttalCandidate = rebuttal ? raceData.candidates.find(c => c.id === rebuttal.candidate_id) : null;

              return (
                <div key={ad.id} className="rounded-2xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
                  <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-900">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                        candidate?.party === "Democrat" ? "bg-blue-600" : candidate?.party === "Republican" ? "bg-red-600" : "bg-zinc-700"
                      }`}>
                        {candidate?.name?.charAt(0) ?? "?"}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-white">{candidate?.name}</div>
                        <div className="text-xs text-zinc-500">{ad.title || 'Sponsored Ad'}</div>
                      </div>
                    </div>
                    <div className="text-xs text-zinc-500">
                      {ad.start_date ? formatDistanceToNow(new Date(ad.start_date)) + " ago" : ""}
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-zinc-800">
                    {/* Main Ad */}
                    <div className="p-6">
                      <div className="flex items-center gap-3 mb-4">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                          candidate?.party === "Democrat" ? "bg-blue-600" : candidate?.party === "Republican" ? "bg-red-600" : "bg-zinc-700"
                        }`}>
                          {candidate?.name?.charAt(0) ?? "?"}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-white">{candidate?.name}</div>
                          <div className="text-xs text-indigo-400">Original Ad</div>
                        </div>
                      </div>
                      {ad.media_url ? (
                        <ContentMedia url={ad.media_url} mediaType={ad.media_type} alt="Ad media" />
                      ) : ad.ad_content_text ? (
                        <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-800 mb-4">
                          <p className="text-zinc-200 text-sm leading-relaxed">{ad.ad_content_text}</p>
                        </div>
                      ) : null}
                      <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-4 border border-zinc-800 p-2 rounded bg-zinc-950/50">
                        {ad.disclaimer_text}
                      </div>
                      <ReactionButtons contentId={ad.id} contentType="ad" />
                    </div>

                    {/* Rebuttal Slot */}
                    {rebuttal ? (
                      <div className="p-6 bg-zinc-900/30">
                        <div className="flex items-center gap-3 mb-4">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                            rebuttalCandidate?.party === "Democrat" ? "bg-blue-600" : rebuttalCandidate?.party === "Republican" ? "bg-red-600" : "bg-zinc-700"
                          }`}>
                            {rebuttalCandidate?.name?.charAt(0) ?? "?"}
                          </div>
                          <div>
                            <div className="text-sm font-medium text-white">{rebuttalCandidate?.name}</div>
                            <div className="text-xs text-emerald-400">Rebuttal</div>
                          </div>
                        </div>
                        {rebuttal.media_url ? (
                          <ContentMedia url={rebuttal.media_url} alt="Rebuttal media" />
                        ) : null}
                        <p className="text-sm text-zinc-300 mb-4 italic">"{rebuttal.response_text}"</p>
                        <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-4 border border-zinc-800 p-2 rounded bg-zinc-950/50">
                          {rebuttal.disclaimer_text}
                        </div>
                        <ReactionButtons contentId={rebuttal.id} contentType="rebuttal" />
                      </div>
                    ) : (
                      <div className="p-6 bg-zinc-900/30 flex flex-col justify-center items-center text-center min-h-[300px]">
                        <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mb-4 text-zinc-500">
                          <MessageSquare className="w-5 h-5" />
                        </div>
                        <h3 className="text-sm font-medium text-white mb-2">Rebuttal Slot Available</h3>
                        <p className="text-xs text-zinc-500 max-w-[200px] mb-4">
                          Opposing candidates can respond directly to this ad.
                        </p>
                        {isCandidateInRace && ad.candidate_id !== activeCandidateId && (
                          <button
                            onClick={() => setClaimingRebuttalForAd(ad.id)}
                            className="text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
                          >
                            Claim Rebuttal Slot
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Challenges Tab */}
      {activeTab === "challenges" && (
        <div className="space-y-6">
          {isCandidateInRace && (
            <div className="flex justify-end mb-4">
              <button
                onClick={() => setIsIssueChallengeModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                Issue Challenge
              </button>
            </div>
          )}

          {raceData.challenges.length === 0 ? (
            <EmptyState title="No challenges yet" description="Candidates haven't issued any challenges in this race." />
          ) : (
            raceData.challenges.map(challenge => {
              const challenger = raceData.candidates.find(c => c.id === challenge.challenger_candidate_id);
              const target = raceData.candidates.find(c => c.id === challenge.target_candidate_id);
              const response = raceData.challengeResponses.find(r => r.challenge_id === challenge.id);

              return (
                <div key={challenge.id} className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/50">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium text-white">{challenger?.name}</span>
                      <span className="text-zinc-500">challenged</span>
                      <span className="font-medium text-white">{target?.name}</span>
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

                  {challenge.status === "open" ? (
                    <>
                      <div className="pl-4 border-l-2 border-indigo-500/30 py-2 mb-4">
                        <p className="text-lg text-zinc-200 font-serif italic">"{challenge.challenge_text}"</p>
                      </div>
                      {challenge.media_url ? (
                        <ContentMedia url={challenge.media_url} alt="Challenge media" />
                      ) : null}
                      <ChallengeCountdown deadline={challenge.response_deadline} businessDays={challenge.deadline_business_days} />
                    </>
                  ) : response ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative mt-4">
                      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-zinc-800 -translate-x-1/2 hidden md:block" />
                      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-zinc-900 border border-zinc-800 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500 hidden md:block z-10">
                        VS
                      </div>

                      <div className="p-6 rounded-xl bg-zinc-950 border border-zinc-800">
                        <div className="flex items-center gap-3 mb-4">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                            challenger?.party === "Democrat" ? "bg-blue-600" : challenger?.party === "Republican" ? "bg-red-600" : "bg-zinc-700"
                          }`}>
                            {challenger?.name?.charAt(0) ?? "?"}
                          </div>
                          <div>
                            <div className="text-sm font-medium text-white">{challenger?.name}</div>
                            <div className="text-xs text-amber-400">Challenger</div>
                          </div>
                        </div>
                        <p className="text-lg text-zinc-200 font-serif italic">"{challenge.challenge_text}"</p>
                        {challenge.media_url ? (
                          <div className="mt-3">
                            <ContentMedia url={challenge.media_url} alt="Challenge media" />
                          </div>
                        ) : null}
                      </div>

                      <div className="p-6 rounded-xl bg-zinc-950 border border-zinc-800">
                        <div className="flex items-center gap-3 mb-4">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                            target?.party === "Democrat" ? "bg-blue-600" : target?.party === "Republican" ? "bg-red-600" : "bg-indigo-600"
                          }`}>
                            {target?.name?.charAt(0) ?? "?"}
                          </div>
                          <div>
                            <div className="text-sm font-medium text-white">{target?.name}</div>
                            <div className="text-xs text-emerald-400">Response</div>
                          </div>
                        </div>
                        {response.media_url ? (
                          <ContentMedia url={response.media_url} alt="Response media" />
                        ) : null}
                        <p className="text-sm text-zinc-300">"{response.response_text}"</p>
                      </div>
                    </div>
                  ) : challenge.status === "expired" ? (
                    <>
                      <div className="pl-4 border-l-2 border-red-500/30 py-2 mb-4">
                        <p className="text-lg text-zinc-200 font-serif italic">"{challenge.challenge_text}"</p>
                      </div>
                      {challenge.media_url ? (
                        <ContentMedia url={challenge.media_url} alt="Challenge media" />
                      ) : null}
                      <div className="flex items-center gap-3 p-4 rounded-lg bg-red-950/30 border border-red-500/20">
                        <ShieldAlert className="w-6 h-6 text-red-400 flex-shrink-0" />
                        <div>
                          <div className="text-sm font-bold text-red-400 uppercase tracking-wider">No Response</div>
                          <div className="text-xs text-zinc-400 mt-0.5">
                            {target?.name} did not respond within the {challenge.deadline_business_days || 3} business day deadline.
                            Challenge expired {challenge.expired_at ? formatDistanceToNow(new Date(challenge.expired_at), { addSuffix: true }) : ""}.
                          </div>
                        </div>
                      </div>
                    </>
                  ) : challenge.status === "refused" ? (
                    <>
                      <div className="pl-4 border-l-2 border-orange-500/30 py-2 mb-4">
                        <p className="text-lg text-zinc-200 font-serif italic">"{challenge.challenge_text}"</p>
                      </div>
                      <div className="flex items-center gap-3 p-4 rounded-lg bg-orange-950/30 border border-orange-500/20">
                        <ShieldAlert className="w-6 h-6 text-orange-400 flex-shrink-0" />
                        <div>
                          <div className="text-sm font-bold text-orange-400 uppercase tracking-wider">Challenge Refused</div>
                          <div className="text-xs text-zinc-400 mt-0.5">
                            {target?.name} refused to respond.{challenge.refusal_reason ? ` Reason: "${challenge.refusal_reason}"` : ""}
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="pl-4 border-l-2 border-indigo-500/30 py-2">
                      <p className="text-lg text-zinc-200 font-serif italic">"{challenge.challenge_text}"</p>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Questions Tab */}
      {activeTab === "questions" && (
        <QuestionsTab raceId={id!} />
      )}

      {/* Issue Challenge Modal */}
      {isIssueChallengeModalOpen && (
        <IssueChallengeModal
          onClose={(refresh) => {
            setIsIssueChallengeModalOpen(false);
            if (refresh) refreshRace();
          }}
          raceId={id!}
          challengerId={activeCandidateId!}
          candidates={raceData.candidates.filter(c => c.id !== activeCandidateId)}
        />
      )}

      {/* Claim Rebuttal Modal */}
      {claimingRebuttalForAd && (
        <ClaimRebuttalModal
          onClose={(refresh) => {
            setClaimingRebuttalForAd(null);
            if (refresh) refreshRace();
          }}
          adId={claimingRebuttalForAd}
          raceId={id!}
          candidateId={activeCandidateId!}
        />
      )}
    </div>
  );
}

// ---- Sub-components ----

function ChallengeCountdown({ deadline, businessDays }: { deadline: string; businessDays?: number }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  if (!deadline) return null;
  const deadlineMs = new Date(deadline).getTime();
  const remaining = deadlineMs - now;

  if (remaining <= 0) {
    return (
      <div className="flex items-center gap-3 p-4 rounded-lg bg-red-950/30 border border-red-500/20">
        <Clock className="w-5 h-5 text-red-400 flex-shrink-0" />
        <div className="text-sm font-medium text-red-400">Deadline has passed</div>
      </div>
    );
  }

  const days = Math.floor(remaining / 86400000);
  const hours = Math.floor((remaining % 86400000) / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);

  const totalHours = remaining / 3600000;
  const color = totalHours > 48 ? "emerald" : totalHours > 24 ? "amber" : "red";
  const pulse = totalHours < 6;

  return (
    <div className={`flex items-center gap-3 p-4 rounded-lg border ${
      color === "emerald" ? "bg-emerald-950/20 border-emerald-500/20" :
      color === "amber" ? "bg-amber-950/20 border-amber-500/20" :
      "bg-red-950/30 border-red-500/20"
    }`}>
      <Clock className={`w-5 h-5 flex-shrink-0 ${
        color === "emerald" ? "text-emerald-400" : color === "amber" ? "text-amber-400" : "text-red-400"
      } ${pulse ? "animate-pulse" : ""}`} />
      <div className="flex items-center gap-2">
        <div className="flex gap-1.5">
          {days > 0 && (
            <span className={`px-2 py-1 rounded text-sm font-bold ${
              color === "emerald" ? "bg-emerald-500/10 text-emerald-300" :
              color === "amber" ? "bg-amber-500/10 text-amber-300" :
              "bg-red-500/10 text-red-300"
            }`}>{days}d</span>
          )}
          <span className={`px-2 py-1 rounded text-sm font-bold ${
            color === "emerald" ? "bg-emerald-500/10 text-emerald-300" :
            color === "amber" ? "bg-amber-500/10 text-amber-300" :
            "bg-red-500/10 text-red-300"
          }`}>{hours}h</span>
          <span className={`px-2 py-1 rounded text-sm font-bold ${
            color === "emerald" ? "bg-emerald-500/10 text-emerald-300" :
            color === "amber" ? "bg-amber-500/10 text-amber-300" :
            "bg-red-500/10 text-red-300"
          }`}>{minutes}m</span>
        </div>
        <span className="text-xs text-zinc-500">remaining ({businessDays || 3} business day deadline)</span>
      </div>
    </div>
  );
}

function MediaUploadField({ onMediaUrl, label }: { onMediaUrl: (url: string) => void; label?: string }) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<{ name: string; size: string; type: string; url?: string } | null>(null);
  const [pasteUrl, setPasteUrl] = useState("");
  const [error, setError] = useState("");

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    // Per-type size limits matching backend
    const sizeLimits: Record<string, number> = { video: 50, image: 10, audio: 20 };
    const category = file.type.split("/")[0];
    const maxMB = sizeLimits[category] || 10;
    const maxSize = maxMB * 1024 * 1024;
    if (file.size > maxSize) {
      setError(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum for ${category} is ${maxMB}MB.`);
      return;
    }
    setUploading(true);

    // Show local preview immediately
    const sizeStr = file.size > 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(1)}MB` : `${(file.size / 1024).toFixed(0)}KB`;
    const localUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
    setPreview({ name: file.name, size: sizeStr, type: file.type, url: localUrl });

    try {
      const result = await api.uploadMedia(file);
      onMediaUrl(result.url);
    } catch (err: any) {
      setPreview(null);
      setError(err?.response?.data?.error || "Upload failed — please try again");
    } finally {
      setUploading(false);
    }
  };

  const handlePaste = () => {
    const url = pasteUrl.trim();
    if (url) {
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          setError("Only http/https URLs are allowed");
          return;
        }
        setError("");
        setPreview({ name: "External link", size: "", type: "link", url });
        onMediaUrl(url);
      } catch {
        setError("Invalid URL format");
      }
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-zinc-400 mb-1.5">{label || "Attach Media"}</label>
      {preview ? (
        <div className={`flex items-center gap-3 p-3 rounded-lg bg-zinc-950 border ${uploading ? 'border-indigo-500/50 animate-pulse' : 'border-zinc-800'}`}>
          {preview.url && preview.type.startsWith("image") ? (
            <img src={preview.url} alt="" className="w-12 h-12 rounded object-cover" />
          ) : (
            <div className="w-12 h-12 rounded bg-zinc-800 flex items-center justify-center">
              <Play className="w-5 h-5 text-zinc-400" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm text-white truncate">{preview.name}</div>
            <div className="text-xs text-zinc-500">{uploading ? "Uploading..." : preview.size}</div>
          </div>
          {!uploading && (
            <button type="button" onClick={() => { setPreview(null); onMediaUrl(""); }} className="text-zinc-500 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <label className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-zinc-950 border border-dashed border-zinc-700 hover:border-indigo-500/50 cursor-pointer transition-colors">
            <Upload className="w-4 h-4 text-zinc-400" />
            <span className="text-sm text-zinc-400">{uploading ? "Uploading..." : "Upload video, image, or audio"}</span>
            <input type="file" accept="video/*,image/*,audio/*" className="hidden" onChange={handleFile} disabled={uploading} />
          </label>
          <div className="flex gap-2">
            <input
              type="url"
              placeholder="Or paste media URL..."
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
              value={pasteUrl}
              onChange={e => setPasteUrl(e.target.value)}
            />
            <button type="button" onClick={handlePaste} disabled={!pasteUrl.trim()} className="px-3 py-1.5 text-xs font-medium text-indigo-400 hover:text-indigo-300 disabled:text-zinc-600 transition-colors">
              Use
            </button>
          </div>
        </div>
      )}
      {error && <div className="text-xs text-amber-400 mt-1">{error}</div>}
    </div>
  );
}

/** Smart media display: renders YouTube embed, <video>, or <img> with onError fallback */
function ContentMedia({ url, mediaType, alt }: { url: string; mediaType?: string; alt?: string }) {
  const [errored, setErrored] = useState(false);

  // Detect YouTube URLs and extract video ID
  const youtubeMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  const youtubeId = youtubeMatch ? youtubeMatch[1] : null;

  // Detect actual content type from URL extension
  const isVideoUrl = /\.(mp4|webm|ogg|mov)(\?|$)/i.test(url);
  const isAudioUrl = /\.(mp3|wav|ogg|m4a|aac)(\?|$)/i.test(url);
  const shouldRenderVideo = (mediaType === 'video' && isVideoUrl) || isVideoUrl;

  if (errored) {
    return (
      <div className="aspect-video bg-zinc-950 rounded-lg mb-4 flex items-center justify-center border border-zinc-800">
        <div className="text-center">
          <AlertCircle className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
          <div className="text-xs text-zinc-500">Media unavailable</div>
        </div>
      </div>
    );
  }

  // YouTube embed
  if (youtubeId) {
    return (
      <div className="aspect-video bg-zinc-950 rounded-lg mb-4 overflow-hidden border border-zinc-800">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${youtubeId}`}
          title={alt || "YouTube video"}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="w-full h-full"
        />
      </div>
    );
  }

  // Native video
  if (shouldRenderVideo) {
    return (
      <div className="aspect-video bg-zinc-950 rounded-lg mb-4 overflow-hidden border border-zinc-800">
        <video
          src={url}
          controls
          preload="metadata"
          className="w-full h-full object-cover"
          onError={() => setErrored(true)}
        />
      </div>
    );
  }

  // Audio
  if (isAudioUrl) {
    return (
      <div className="bg-zinc-950 rounded-lg mb-4 p-4 border border-zinc-800">
        <audio src={url} controls preload="metadata" className="w-full" onError={() => setErrored(true)} />
      </div>
    );
  }

  // Default: render as image
  return (
    <div className="aspect-video bg-zinc-950 rounded-lg mb-4 relative group overflow-hidden border border-zinc-800">
      <img
        src={url}
        alt={alt || "Media"}
        className="w-full h-full object-cover opacity-70 group-hover:opacity-90 transition-opacity"
        onError={() => setErrored(true)}
      />
      {mediaType === 'video' && (
        <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/60 text-[10px] text-zinc-400">
          Image preview
        </div>
      )}
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

function ReactionButtons({ contentId, contentType }: { contentId: string; contentType: string }) {
  const { user } = useAuth();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [activeReaction, setActiveReaction] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getReactions(contentType, contentId).then((data: any) => {
      if (cancelled) return;
      if (data?.counts) {
        setCounts(data.counts);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [contentId, contentType]);

  const handleReact = async (type: string) => {
    if (!user) return; // Must be logged in
    if (activeReaction === type) return; // Already reacted with this type

    const prevReaction = activeReaction;
    const prevCounts = { ...counts };

    // Optimistic: remove old reaction, add new
    setActiveReaction(type);
    setCounts(prev => {
      const next = { ...prev };
      if (prevReaction) next[prevReaction] = Math.max((next[prevReaction] || 1) - 1, 0);
      next[type] = (next[type] || 0) + 1;
      return next;
    });

    try {
      await api.addReaction({ content_type: contentType, content_id: contentId, reaction_type: type });
    } catch {
      // Rollback on failure
      setActiveReaction(prevReaction);
      setCounts(prevCounts);
    }
  };

  return (
    <div className="flex gap-3">
      <button
        onClick={() => handleReact("helpful")}
        disabled={!user}
        title={!user ? "Sign in to react" : "Mark as helpful"}
        aria-label={`Mark as helpful (${counts["helpful"] || 0} votes)`}
        className={`flex items-center gap-2 text-xs font-medium transition-colors px-3 py-1.5 rounded-full border ${
          activeReaction === "helpful"
            ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
            : "text-zinc-400 hover:text-white bg-zinc-950 border-zinc-800 hover:border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-zinc-400"
        }`}
      >
        <ThumbsUp className="w-4 h-4" />
        <span>{counts["helpful"] || 0}</span>
      </button>
      <button
        onClick={() => handleReact("misleading")}
        disabled={!user}
        title={!user ? "Sign in to react" : "Mark as misleading"}
        aria-label={`Mark as misleading (${counts["misleading"] || 0} votes)`}
        className={`flex items-center gap-2 text-xs font-medium transition-colors px-3 py-1.5 rounded-full border ${
          activeReaction === "misleading"
            ? "bg-red-500/20 text-red-400 border-red-500/30"
            : "text-zinc-400 hover:text-white bg-zinc-950 border-zinc-800 hover:border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-zinc-400"
        }`}
      >
        <ThumbsDown className="w-4 h-4" />
        <span>{counts["misleading"] || 0}</span>
      </button>
    </div>
  );
}

function IssueChallengeModal({
  onClose, raceId, challengerId, candidates
}: {
  onClose: (refresh?: boolean) => void;
  raceId: string;
  challengerId: string;
  candidates: { id: string; name: string }[];
}) {
  const [formData, setFormData] = useState({
    target_candidate_id: candidates.length > 0 ? candidates[0].id : "",
    challenge_text: "",
    media_url: "",
    deadline_business_days: 3,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await api.createChallenge({
        race_id: raceId,
        challenger_candidate_id: challengerId,
        target_candidate_id: formData.target_candidate_id,
        challenge_text: formData.challenge_text,
        media_url: formData.media_url || undefined,
        deadline_business_days: formData.deadline_business_days,
      });
      onClose(true);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to create challenge');
      setSubmitting(false);
    }
  };

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => onClose()}>
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-white">Issue Challenge</h2>
          <button onClick={() => onClose()} className="text-zinc-400 hover:text-white p-1 rounded-md hover:bg-zinc-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">Target Candidate</label>
            <select
              required
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
              value={formData.target_candidate_id}
              onChange={e => setFormData({ ...formData, target_candidate_id: e.target.value })}
            >
              {candidates.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">Challenge Statement</label>
            <textarea
              required
              autoFocus
              rows={4}
              minLength={10}
              maxLength={2000}
              placeholder="Type your challenge here..."
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors resize-none"
              value={formData.challenge_text}
              onChange={e => setFormData({ ...formData, challenge_text: e.target.value })}
            />
            <div className="text-xs text-zinc-500 mt-1">{formData.challenge_text.length}/2000</div>
          </div>
          <MediaUploadField onMediaUrl={url => setFormData({ ...formData, media_url: url })} label="Attach Evidence (video, image, audio)" />
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">Response Deadline</label>
            <select
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
              value={formData.deadline_business_days}
              onChange={e => setFormData({ ...formData, deadline_business_days: parseInt(e.target.value) })}
            >
              <option value={3}>3 business days (minimum)</option>
              <option value={5}>5 business days</option>
              <option value={7}>7 business days</option>
              <option value={10}>10 business days (maximum)</option>
            </select>
            <p className="text-xs text-zinc-500 mt-1">Weekends (Sat/Sun) are not counted. Minimum 3 business days.</p>
          </div>
          <div className="pt-4 flex justify-end gap-3">
            <button type="button" onClick={() => onClose()} className="px-4 py-2 text-sm font-medium text-zinc-300 hover:text-white transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {submitting ? 'Submitting...' : 'Issue Challenge'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function QuestionsTab({ raceId }: { raceId: string }) {
  const { user } = useAuth();
  const [subTab, setSubTab] = useState<"voter" | "press">("voter");
  const [questions, setQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [voteError, setVoteError] = useState("");
  const [askModalOpen, setAskModalOpen] = useState(false);
  const [pressStatus, setPressStatus] = useState<string | null>(null);
  const [votingId, setVotingId] = useState<string | null>(null); // lock for rapid-click prevention

  const fetchQuestions = () => {
    setLoading(true);
    setFetchError(false);
    api.getQuestions(raceId, subTab)
      .then(data => setQuestions(data.questions || []))
      .catch(() => { setQuestions([]); setFetchError(true); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchQuestions();
  }, [raceId, subTab]);

  // Fetch press credential status for logged-in users
  useEffect(() => {
    if (user) {
      api.getPressStatus()
        .then(data => setPressStatus(data.credential?.status || null))
        .catch(() => setPressStatus(null));
    }
  }, [user]);

  // Check if user can participate in current sub-tab
  const isVerifiedVoter = user && user.verification_status === 'verified';
  const isApprovedPress = pressStatus === 'approved';
  const canParticipate = subTab === 'voter' ? isVerifiedVoter : isApprovedPress;

  const handleVote = async (questionId: string) => {
    if (!user) return;
    if (votingId) return; // Lock: prevent rapid double-click
    if (!canParticipate) {
      setVoteError(subTab === 'voter'
        ? 'You must be a verified voter to vote on voter questions.'
        : 'You need approved press credentials to vote on press questions.');
      setTimeout(() => setVoteError(""), 4000);
      return;
    }
    setVoteError("");
    setVotingId(questionId);
    // Optimistic update
    setQuestions(prev => prev.map(q => {
      if (q.id === questionId) {
        const newVoted = !q.has_voted;
        return { ...q, has_voted: newVoted, vote_count: q.vote_count + (newVoted ? 1 : -1) };
      }
      return q;
    }));
    try {
      const result = await api.voteQuestion(questionId);
      // Reconcile with server truth
      setQuestions(prev => prev.map(q =>
        q.id === questionId ? { ...q, has_voted: result.voted, vote_count: result.vote_count } : q
      ));
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Vote failed';
      setVoteError(msg);
      setTimeout(() => setVoteError(""), 4000);
      fetchQuestions();
    } finally {
      setVotingId(null);
    }
  };

  return (
    <div>
      {/* Sub-tabs */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <button
          onClick={() => setSubTab("voter")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            subTab === "voter"
              ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
              : "text-zinc-400 hover:text-white border border-zinc-800 hover:border-zinc-700"
          }`}
        >
          Voter Questions
        </button>
        <button
          onClick={() => setSubTab("press")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            subTab === "press"
              ? "bg-violet-500/20 text-violet-300 border border-violet-500/30"
              : "text-zinc-400 hover:text-white border border-zinc-800 hover:border-zinc-700"
          }`}
        >
          Press Questions
        </button>
        <div className="flex-1" />
        {user && canParticipate ? (
          <button
            onClick={() => setAskModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors flex-shrink-0"
          >
            <Plus className="w-4 h-4" />
            Ask a Question
          </button>
        ) : user && !canParticipate ? (
          <div className="text-xs text-zinc-500 max-w-[200px] text-right">
            {subTab === 'voter'
              ? 'Verify your voter status to ask questions'
              : 'Get press credentials to ask questions'}
          </div>
        ) : !user ? (
          <a href="/login" className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors flex-shrink-0">
            Sign in to ask a question
          </a>
        ) : null}
      </div>

      {/* Vote error toast */}
      {voteError && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {voteError}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
        </div>
      ) : fetchError ? (
        <div className="p-12 text-center border border-red-500/20 rounded-2xl bg-red-950/10">
          <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-3" />
          <div className="text-zinc-400 mb-2">Failed to load questions</div>
          <button onClick={fetchQuestions} className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors">
            Try again
          </button>
        </div>
      ) : questions.length === 0 ? (
        <EmptyState
          title={`No ${subTab} questions yet`}
          description={subTab === "voter"
            ? "Verified voters can submit questions for candidates to see."
            : "Credentialed press members can submit questions here."}
        />
      ) : (
        <div className="space-y-3">
          {questions.map((q, idx) => (
            <div
              key={q.id}
              className={`flex gap-4 p-4 rounded-xl border transition-colors ${
                q.is_top
                  ? "border-amber-500/30 bg-amber-500/5"
                  : "border-zinc-800 bg-zinc-900/50"
              }`}
            >
              {/* Vote button */}
              <div className="flex flex-col items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => handleVote(q.id)}
                  disabled={!user || votingId === q.id}
                  aria-label={q.has_voted ? `Remove vote (${q.vote_count} votes)` : `Upvote question (${q.vote_count} votes)`}
                  className={`w-11 h-11 rounded-lg flex items-center justify-center transition-colors ${
                    q.has_voted
                      ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30"
                      : "bg-zinc-950 text-zinc-500 hover:text-white border border-zinc-800 hover:border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  }`}
                  title={!user ? "Sign in to vote" : !canParticipate ? (subTab === 'voter' ? "Verify voter status to vote" : "Press credentials required") : q.has_voted ? "Remove vote" : "Upvote"}
                >
                  <ArrowBigUp className={`w-5 h-5 ${q.has_voted ? "fill-indigo-400" : ""}`} />
                </button>
                <span className={`text-sm font-bold ${q.has_voted ? "text-indigo-400" : "text-zinc-400"}`}>
                  {q.vote_count}
                </span>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {q.is_top && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-400 border border-amber-500/30">
                      TOP 5
                    </span>
                  )}
                  <span className="text-xs text-zinc-500">{q.author_name || "Anonymous"}</span>
                  <span className="text-xs text-zinc-600">
                    {q.created_at ? formatDistanceToNow(new Date(q.created_at), { addSuffix: true }) : ""}
                  </span>
                </div>
                <p className="text-sm text-zinc-200 leading-relaxed">{q.question_text}</p>
                {q.media_url && (
                  <div className="mt-2 max-w-full">
                    <ContentMedia url={q.media_url} alt="Question media" />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {askModalOpen && (
        <AskQuestionModal
          raceId={raceId}
          sourceType={subTab}
          onClose={(refresh) => {
            setAskModalOpen(false);
            if (refresh) fetchQuestions();
          }}
        />
      )}
    </div>
  );
}

function AskQuestionModal({
  raceId, sourceType, onClose,
}: {
  raceId: string;
  sourceType: "voter" | "press";
  onClose: (refresh?: boolean) => void;
}) {
  const [questionText, setQuestionText] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await api.submitQuestion(raceId, {
        source_type: sourceType,
        question_text: questionText,
        media_url: mediaUrl || undefined,
      });
      onClose(true);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || "Failed to submit question");
      setSubmitting(false);
    }
  };

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => onClose()}>
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-white">
            Ask a {sourceType === "voter" ? "Voter" : "Press"} Question
          </h2>
          <button onClick={() => onClose()} className="text-zinc-400 hover:text-white p-1 rounded-md hover:bg-zinc-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">Your Question</label>
            <textarea
              required
              autoFocus
              rows={4}
              minLength={10}
              maxLength={2000}
              placeholder="What question do you want candidates to address?"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors resize-none"
              value={questionText}
              onChange={e => setQuestionText(e.target.value)}
            />
            <div className="text-xs text-zinc-500 mt-1">{questionText.length}/2000</div>
          </div>
          <MediaUploadField onMediaUrl={setMediaUrl} label="Attach Supporting Media (optional)" />
          <div className="pt-2 text-xs text-zinc-500">
            {sourceType === "voter"
              ? "You must be a verified voter to submit. Other verified voters can upvote your question."
              : "You must have approved press credentials. Other credentialed press can upvote."}
          </div>
          <div className="pt-2 flex justify-end gap-3">
            <button type="button" onClick={() => onClose()} className="px-4 py-2 text-sm font-medium text-zinc-300 hover:text-white transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || questionText.length < 10}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {submitting ? "Submitting..." : "Submit Question"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ClaimRebuttalModal({
  onClose, adId, raceId, candidateId
}: {
  onClose: (refresh?: boolean) => void;
  adId: string;
  raceId: string;
  candidateId: string;
}) {
  const [responseText, setResponseText] = useState("");
  const [disclaimerText, setDisclaimerText] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await api.createRebuttal({
        parent_ad_id: adId,
        race_id: raceId,
        candidate_id: candidateId,
        response_text: responseText,
        disclaimer_text: disclaimerText,
        media_url: mediaUrl || undefined,
      });
      onClose(true);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to create rebuttal');
      setSubmitting(false);
    }
  };

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => onClose()}>
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-white">Claim Rebuttal Slot</h2>
          <button onClick={() => onClose()} className="text-zinc-400 hover:text-white p-1 rounded-md hover:bg-zinc-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">Rebuttal Response</label>
            <textarea
              required
              autoFocus
              rows={4}
              placeholder="Write your rebuttal to this ad..."
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors resize-none"
              value={responseText}
              onChange={e => setResponseText(e.target.value)}
            />
          </div>
          <MediaUploadField onMediaUrl={setMediaUrl} label="Attach Rebuttal Media (video, image, audio)" />
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">FEC Disclaimer</label>
            <input
              required
              type="text"
              placeholder="Paid for by..."
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
              value={disclaimerText}
              onChange={e => setDisclaimerText(e.target.value)}
            />
          </div>
          <div className="pt-4 flex justify-end gap-3">
            <button type="button" onClick={() => onClose()} className="px-4 py-2 text-sm font-medium text-zinc-300 hover:text-white transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {submitting ? 'Submitting...' : 'Submit Rebuttal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
