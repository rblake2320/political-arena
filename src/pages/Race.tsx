import React, { useState, useContext, useEffect } from "react";
import { Link, useParams } from "react-router";
import { Shield, ShieldAlert, AlertCircle, ThumbsUp, ThumbsDown, MessageSquare, Plus, X, Clock, ArrowBigUp, HelpCircle, FileCheck2, ExternalLink } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { CandidateContext } from "../App";
import { useArenaStore, type RaceDetail } from "../store";
import * as api from "../api";
import { useAuth } from "../stores/auth";
import { ContentMedia, MediaUploadField } from "../components/Media";

export function Race() {
  const { id } = useParams();
  const [activeTab, setActiveTab] = useState<"ads" | "challenges" | "questions">("ads");
  const { activeCandidateId } = useContext(CandidateContext);
  const [isIssueChallengeModalOpen, setIsIssueChallengeModalOpen] = useState(false);
  const [isOutsideAdModalOpen, setIsOutsideAdModalOpen] = useState(false);
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
            <Link key={c.id} to={`/profile/candidate/${c.id}`} className="flex-shrink-0 w-64 p-4 rounded-xl border border-zinc-800 bg-zinc-900/30 hover:border-zinc-700 transition-colors">
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
            </Link>
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
          {isCandidateInRace && activeCandidateId && (
            <div className="flex justify-end">
              <button
                onClick={() => setIsOutsideAdModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors text-sm"
              >
                <Plus className="w-4 h-4" />
                Respond to Outside Ad
              </button>
            </div>
          )}
          {raceData.ads.length === 0 ? (
            <EmptyState title="No ads yet" description="Post an ad, or answer an outside TV/digital ad with a side-by-side response." />
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
                        {candidate ? (
                          <Link to={`/profile/candidate/${candidate.id}`} className="text-sm font-medium text-white hover:text-indigo-200">
                            {candidate.name}
                          </Link>
                        ) : (
                          <div className="text-sm font-medium text-white">Unknown candidate</div>
                        )}
                        <div className="text-xs text-zinc-500">
                          {ad.source_type === 'external' ? 'Outside ad being answered' : (ad.title || 'Sponsored Ad')}
                        </div>
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
                          {candidate ? (
                            <Link to={`/profile/candidate/${candidate.id}`} className="text-sm font-medium text-white hover:text-indigo-200">
                              {candidate.name}
                            </Link>
                          ) : (
                            <div className="text-sm font-medium text-white">Unknown candidate</div>
                          )}
                          <div className="text-xs text-indigo-400">
                            {ad.source_type === 'external' ? 'Outside TV/Digital Ad' : 'Original Ad'}
                          </div>
                        </div>
                      </div>
                      {ad.source_type === 'external' && (
                        <div className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                          Shared as context so the response can be seen beside the original claim.
                        </div>
                      )}
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
                            {rebuttalCandidate ? (
                              <Link to={`/profile/candidate/${rebuttalCandidate.id}`} className="text-sm font-medium text-white hover:text-indigo-200">
                                {rebuttalCandidate.name}
                              </Link>
                            ) : (
                              <div className="text-sm font-medium text-white">Unknown candidate</div>
                            )}
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
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/challenge/${challenge.public_receipt_slug || challenge.id}`}
                        className="text-xs font-medium text-indigo-300 hover:text-indigo-200 transition-colors"
                      >
                        Receipt
                      </Link>
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
                        <div className="mt-4">
                          <ReactionButtons contentId={response.id} contentType="challenge_response" />
                        </div>
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
                  <div className="mt-4">
                    <ReactionButtons contentId={challenge.id} contentType="challenge" />
                  </div>
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

      {/* Outside Ad Response Modal */}
      {isOutsideAdModalOpen && activeCandidateId && (
        <OutsideAdResponseModal
          onClose={(refresh) => {
            setIsOutsideAdModalOpen(false);
            if (refresh) refreshRace();
          }}
          raceId={id!}
          responderCandidateId={activeCandidateId}
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

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="p-12 text-center border border-zinc-800 rounded-2xl bg-zinc-900/30">
      <div className="text-zinc-400 mb-2">{title}</div>
      <div className="text-sm text-zinc-500">{description}</div>
    </div>
  );
}

type Recite = {
  id: string;
  url: string;
  title: string;
  publisher?: string | null;
  source_type: api.ReciteSourceType;
  stance: api.ReciteStance;
  status: "pending" | "verified" | "rejected";
  quote?: string | null;
  source_published_at?: string | null;
  accessed_at?: string | null;
  archive_url?: string | null;
  evidence_media_url?: string | null;
  review_note?: string | null;
  author_name?: string | null;
  created_at?: string;
};

type FactScore = {
  score: number;
  label: string;
  confidence: number;
  verified_count: number;
  pending_count: number;
};

const RECITE_SOURCE_OPTIONS: { value: api.ReciteSourceType; label: string }[] = [
  { value: "official_record", label: "Official record" },
  { value: "court_record", label: "Court record" },
  { value: "public_document", label: "Public document" },
  { value: "research", label: "Research" },
  { value: "news", label: "News report" },
  { value: "campaign_material", label: "Campaign material" },
  { value: "other", label: "Other" },
];

const RECITE_STANCE_OPTIONS: { value: api.ReciteStance; label: string }[] = [
  { value: "supports", label: "Supports" },
  { value: "refutes", label: "Refutes" },
  { value: "context", label: "Adds context" },
];

function factScoreLabel(label?: string) {
  if (label === "source-supported") return "Source-supported";
  if (label === "source-disputed") return "Source-disputed";
  if (label === "mixed") return "Mixed recites";
  return "Under-recited";
}

function factScoreClass(label?: string) {
  if (label === "source-supported") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  if (label === "source-disputed") return "border-red-500/30 bg-red-500/10 text-red-300";
  if (label === "mixed") return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  return "border-zinc-700 bg-zinc-900 text-zinc-300";
}

function stanceClass(stance: string) {
  if (stance === "supports") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  if (stance === "refutes") return "border-red-500/30 bg-red-500/10 text-red-300";
  return "border-sky-500/30 bg-sky-500/10 text-sky-300";
}

function sourceLabel(value: string) {
  return RECITE_SOURCE_OPTIONS.find(option => option.value === value)?.label || "Other";
}

function ReactionButtons({ contentId, contentType }: { contentId: string; contentType: api.ReciteContentType }) {
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
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
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
      <RecitePanel contentId={contentId} contentType={contentType} />
    </div>
  );
}

function RecitePanel({ contentId, contentType }: { contentId: string; contentType: api.ReciteContentType }) {
  const { user } = useAuth();
  const [recites, setRecites] = useState<Recite[]>([]);
  const [factScore, setFactScore] = useState<FactScore | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState({
    url: "",
    title: "",
    publisher: "",
    source_type: "news" as api.ReciteSourceType,
    stance: "supports" as api.ReciteStance,
    claim_text: "",
    quote: "",
    source_published_at: "",
    accessed_at: new Date().toISOString().slice(0, 10),
    archive_url: "",
  });

  const refreshRecites = async () => {
    const data = await api.getRecites(contentType, contentId);
    setRecites(data.recites || []);
    setFactScore(data.fact_score || null);
  };

  useEffect(() => {
    let cancelled = false;
    api.getRecites(contentType, contentId).then((data: any) => {
      if (cancelled) return;
      setRecites(data.recites || []);
      setFactScore(data.fact_score || null);
    }).catch(() => {
      if (cancelled) return;
      setRecites([]);
      setFactScore(null);
    });
    return () => { cancelled = true; };
  }, [contentId, contentType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);
    setError("");
    try {
      await api.addRecite({
        content_type: contentType,
        content_id: contentId,
        url: formData.url.trim(),
        title: formData.title.trim(),
        publisher: formData.publisher.trim() || undefined,
        source_type: formData.source_type,
        stance: formData.stance,
        claim_text: formData.claim_text.trim() || undefined,
        quote: formData.quote.trim() || undefined,
        source_published_at: formData.source_published_at || undefined,
        accessed_at: formData.accessed_at || undefined,
        archive_url: formData.archive_url.trim() || undefined,
      });
      setFormData({
        url: "",
        title: "",
        publisher: "",
        source_type: "news",
        stance: "supports",
        claim_text: "",
        quote: "",
        source_published_at: "",
        accessed_at: new Date().toISOString().slice(0, 10),
        archive_url: "",
      });
      await refreshRecites();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || "Failed to add recite");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReview = async (reciteId: string, status: "pending" | "verified" | "rejected") => {
    setReviewingId(reciteId);
    setError("");
    try {
      await api.reviewRecite(reciteId, status);
      await refreshRecites();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || "Failed to review recite");
    } finally {
      setReviewingId(null);
    }
  };

  const score = factScore?.score ?? 50;
  const label = factScoreLabel(factScore?.label);
  const confidence = factScore?.confidence ?? 0;
  const canSubmit = Boolean(user && formData.url.trim() && formData.title.trim());
  const canReview = Boolean(user && ["moderator", "admin", "super_admin"].includes(user.role));

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
          <FileCheck2 className="w-4 h-4 text-indigo-300" />
          <span>Fact score</span>
        </div>
        <span className={`px-2 py-1 rounded-full border text-xs font-semibold ${factScoreClass(factScore?.label)}`}>
          {score}/100
        </span>
        <span className="text-xs text-zinc-400">{label}</span>
        <span className="text-xs text-zinc-600">Confidence {confidence}%</span>
        <span className="text-xs text-zinc-600">{recites.length} recite{recites.length === 1 ? "" : "s"}</span>
        <button
          type="button"
          onClick={() => setExpanded(value => !value)}
          className="ml-auto text-xs font-medium text-indigo-300 hover:text-indigo-200 transition-colors"
        >
          {expanded ? "Close" : user ? "Add or view recites" : "View recites"}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 border-t border-zinc-800 pt-3 space-y-3">
          {recites.length > 0 ? (
            <div className="space-y-2">
              {recites.slice(0, 5).map(recite => (
                <div
                  key={recite.id}
                  className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider ${stanceClass(recite.stance)}`}>
                      {recite.stance}
                    </span>
                    <span className="text-[10px] text-zinc-500 uppercase tracking-wider">{sourceLabel(recite.source_type)}</span>
                    <span className="text-[10px] text-zinc-500">{recite.status}</span>
                    {recite.created_at && (
                      <span className="text-[10px] text-zinc-600">
                        {formatDistanceToNow(new Date(recite.created_at), { addSuffix: true })}
                      </span>
                    )}
                  </div>
                  <div className="flex items-start gap-2 min-w-0">
                    <div className="flex-1 min-w-0">
                      <a
                        href={recite.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-start gap-1 text-xs font-medium text-zinc-100 hover:text-indigo-200 break-words"
                      >
                        <span>{recite.title}</span>
                        <ExternalLink className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0 mt-0.5" />
                      </a>
                      {recite.publisher && <div className="text-[11px] text-zinc-500 break-words">{recite.publisher}</div>}
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-zinc-600">
                        {recite.source_published_at && <span>Published {recite.source_published_at}</span>}
                        {recite.accessed_at && <span>Accessed {recite.accessed_at.slice(0, 10)}</span>}
                        {recite.archive_url && (
                          <a href={recite.archive_url} target="_blank" rel="noreferrer" className="text-indigo-300 hover:text-indigo-200">
                            Archived copy
                          </a>
                        )}
                      </div>
                      {recite.quote && <div className="mt-1 text-[11px] text-zinc-400 line-clamp-2 break-words">"{recite.quote}"</div>}
                    </div>
                  </div>
                  {canReview && (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-zinc-800 pt-2">
                      {recite.status !== "verified" && (
                        <button
                          type="button"
                          disabled={reviewingId === recite.id}
                          onClick={() => handleReview(recite.id, "verified")}
                          className="px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[11px] font-medium hover:bg-emerald-500/20 disabled:opacity-50 transition-colors"
                        >
                          Verify
                        </button>
                      )}
                      {recite.status !== "pending" && (
                        <button
                          type="button"
                          disabled={reviewingId === recite.id}
                          onClick={() => handleReview(recite.id, "pending")}
                          className="px-2 py-1 rounded-md bg-zinc-800 text-zinc-300 border border-zinc-700 text-[11px] font-medium hover:bg-zinc-700 disabled:opacity-50 transition-colors"
                        >
                          Mark pending
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={reviewingId === recite.id}
                        onClick={() => handleReview(recite.id, "rejected")}
                        className="px-2 py-1 rounded-md bg-red-500/10 text-red-300 border border-red-500/20 text-[11px] font-medium hover:bg-red-500/20 disabled:opacity-50 transition-colors"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-500">
              No recites yet. Add a link to an official record, article, document, or other source that supports, refutes, or adds context.
            </div>
          )}

          {user ? (
            <form onSubmit={handleSubmit} className="space-y-3">
              {error && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {error}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Recite URL</label>
                  <input
                    required
                    inputMode="url"
                    type="url"
                    maxLength={1000}
                    placeholder="https://..."
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                    value={formData.url}
                    onChange={e => setFormData({ ...formData, url: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Title</label>
                  <input
                    required
                    type="text"
                    maxLength={240}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                    value={formData.title}
                    onChange={e => setFormData({ ...formData, title: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Publisher</label>
                  <input
                    type="text"
                    maxLength={120}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                    value={formData.publisher}
                    onChange={e => setFormData({ ...formData, publisher: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">How it applies</label>
                  <select
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                    value={formData.stance}
                    onChange={e => setFormData({ ...formData, stance: e.target.value as api.ReciteStance })}
                  >
                    {RECITE_STANCE_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Source type</label>
                  <select
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                    value={formData.source_type}
                    onChange={e => setFormData({ ...formData, source_type: e.target.value as api.ReciteSourceType })}
                  >
                    {RECITE_SOURCE_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Relevant quote or note</label>
                  <textarea
                    rows={2}
                    maxLength={1000}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors resize-none"
                    value={formData.quote}
                    onChange={e => setFormData({ ...formData, quote: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Publication date</label>
                  <input
                    type="date"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                    value={formData.source_published_at}
                    onChange={e => setFormData({ ...formData, source_published_at: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Accessed date</label>
                  <input
                    type="date"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                    value={formData.accessed_at}
                    onChange={e => setFormData({ ...formData, accessed_at: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Archive URL</label>
                  <input
                    inputMode="url"
                    type="url"
                    maxLength={1000}
                    placeholder="https://web.archive.org/..."
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                    value={formData.archive_url}
                    onChange={e => setFormData({ ...formData, archive_url: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={submitting || !canSubmit}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  {submitting ? "Adding..." : "Add recite"}
                </button>
              </div>
            </form>
          ) : (
            <a href="/login" className="inline-block text-xs text-indigo-300 hover:text-indigo-200 transition-colors">
              Sign in to add a recite
            </a>
          )}
        </div>
      )}
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
    challenge_type: "fact_check",
    claim_text: "",
    dispute_summary: "",
    requested_response: "",
    challenge_text: "",
    media_url: "",
    deadline_business_days: 3,
    recite_url: "",
    recite_title: "",
    recite_publisher: "",
    recite_source_type: "official_record" as api.ReciteSourceType,
    recite_quote: "",
    recite_source_published_at: "",
    recite_accessed_at: new Date().toISOString().slice(0, 10),
    recite_archive_url: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const isFactCheck = formData.challenge_type === "fact_check";
    if (isFactCheck && (!formData.recite_url.trim() || !formData.recite_title.trim())) {
      setError("Fact-check callouts need at least one recite URL and title.");
      return;
    }
    if (isFactCheck && formData.claim_text.trim().length < 10) {
      setError("Fact-check callouts need the specific claim being disputed.");
      return;
    }
    setSubmitting(true);
    setError('');
    const initialRecites = formData.recite_url.trim() && formData.recite_title.trim()
      ? [{
          url: formData.recite_url.trim(),
          title: formData.recite_title.trim(),
          publisher: formData.recite_publisher.trim() || undefined,
          source_type: formData.recite_source_type,
          stance: "supports" as api.ReciteStance,
          claim_text: formData.claim_text.trim() || undefined,
          quote: formData.recite_quote.trim() || undefined,
          source_published_at: formData.recite_source_published_at || undefined,
          accessed_at: formData.recite_accessed_at || undefined,
          archive_url: formData.recite_archive_url.trim() || undefined,
        }]
      : undefined;
    try {
      await api.createChallenge({
        race_id: raceId,
        challenger_candidate_id: challengerId,
        target_candidate_id: formData.target_candidate_id,
        challenge_text: formData.challenge_text,
        challenge_type: formData.challenge_type,
        claim_text: formData.claim_text.trim() || undefined,
        dispute_summary: formData.dispute_summary.trim() || undefined,
        requested_response: formData.requested_response.trim() || undefined,
        media_url: formData.media_url || undefined,
        deadline_business_days: formData.deadline_business_days,
        initial_recites: initialRecites,
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
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
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
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">Challenge Type</label>
            <select
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
              value={formData.challenge_type}
              onChange={e => setFormData({ ...formData, challenge_type: e.target.value })}
            >
              <option value="fact_check">Fact-check callout</option>
              <option value="policy_question">Policy question</option>
              <option value="debate_request">Debate request</option>
              <option value="open">Open challenge</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">Specific Claim</label>
            <textarea
              required={formData.challenge_type === "fact_check"}
              rows={2}
              minLength={formData.challenge_type === "fact_check" ? 10 : undefined}
              maxLength={500}
              placeholder="Quote or summarize the exact claim being disputed."
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors resize-none"
              value={formData.claim_text}
              onChange={e => setFormData({ ...formData, claim_text: e.target.value })}
            />
            <div className="text-xs text-zinc-500 mt-1">{formData.claim_text.length}/500</div>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">Challenge Statement</label>
            <textarea
              required
              autoFocus
              rows={4}
              minLength={10}
              maxLength={2000}
              placeholder="Name the claim and what the other candidate needs to answer."
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors resize-none"
              value={formData.challenge_text}
              onChange={e => setFormData({ ...formData, challenge_text: e.target.value })}
            />
            <div className="text-xs text-zinc-500 mt-1">{formData.challenge_text.length}/2000</div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1.5">Why it's disputed</label>
              <textarea
                rows={3}
                maxLength={1000}
                placeholder="Explain how the source contradicts or clarifies the claim."
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors resize-none"
                value={formData.dispute_summary}
                onChange={e => setFormData({ ...formData, dispute_summary: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1.5">Requested response</label>
              <textarea
                rows={3}
                maxLength={500}
                placeholder="What should the tagged campaign answer?"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors resize-none"
                value={formData.requested_response}
                onChange={e => setFormData({ ...formData, requested_response: e.target.value })}
              />
            </div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <FileCheck2 className="w-4 h-4 text-indigo-300" />
              Initial Recite
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Recite URL</label>
              <input
                required={formData.challenge_type === "fact_check"}
                inputMode="url"
                type="url"
                maxLength={1000}
                placeholder="https://..."
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                value={formData.recite_url}
                onChange={e => setFormData({ ...formData, recite_url: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">Title</label>
                <input
                  required={formData.challenge_type === "fact_check"}
                  type="text"
                  maxLength={240}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                  value={formData.recite_title}
                  onChange={e => setFormData({ ...formData, recite_title: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">Publisher</label>
                <input
                  type="text"
                  maxLength={120}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                  value={formData.recite_publisher}
                  onChange={e => setFormData({ ...formData, recite_publisher: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Source type</label>
              <select
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                value={formData.recite_source_type}
                onChange={e => setFormData({ ...formData, recite_source_type: e.target.value as api.ReciteSourceType })}
              >
                {RECITE_SOURCE_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Relevant quote or note</label>
              <textarea
                rows={2}
                maxLength={1000}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors resize-none"
                value={formData.recite_quote}
                onChange={e => setFormData({ ...formData, recite_quote: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">Publication date</label>
                <input
                  type="date"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                  value={formData.recite_source_published_at}
                  onChange={e => setFormData({ ...formData, recite_source_published_at: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">Accessed date</label>
                <input
                  type="date"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                  value={formData.recite_accessed_at}
                  onChange={e => setFormData({ ...formData, recite_accessed_at: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Archive URL</label>
              <input
                inputMode="url"
                type="url"
                maxLength={1000}
                placeholder="https://web.archive.org/..."
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                value={formData.recite_archive_url}
                onChange={e => setFormData({ ...formData, recite_archive_url: e.target.value })}
              />
            </div>
          </div>
          <MediaUploadField candidateId={challengerId} onMediaUrl={url => setFormData({ ...formData, media_url: url })} label="Attach Evidence (video, image, audio)" />
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

function OutsideAdResponseModal({
  onClose, raceId, responderCandidateId, candidates
}: {
  onClose: (refresh?: boolean) => void;
  raceId: string;
  responderCandidateId: string;
  candidates: { id: string; name: string }[];
}) {
  const [formData, setFormData] = useState({
    source_candidate_id: candidates.length > 0 ? candidates[0].id : "",
    source_title: "",
    source_media_url: "",
    source_description: "",
    response_text: "",
    response_media_url: "",
    disclaimer_text: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.source_media_url) {
      setError("Attach or link the outside ad first");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await api.createExternalAdResponse({
        race_id: raceId,
        source_candidate_id: formData.source_candidate_id,
        responder_candidate_id: responderCandidateId,
        source_title: formData.source_title,
        source_media_url: formData.source_media_url,
        source_description: formData.source_description || undefined,
        response_text: formData.response_text,
        response_media_url: formData.response_media_url || undefined,
        disclaimer_text: formData.disclaimer_text,
      });
      onClose(true);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || "Failed to publish response");
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
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-white">Respond to Outside Ad</h2>
          <button onClick={() => onClose()} className="text-zinc-400 hover:text-white p-1 rounded-md hover:bg-zinc-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Use this when an ad is running on TV, streaming, or social media outside Arena and your campaign needs a lower-cost answer beside it.
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">Candidate Behind the Outside Ad</label>
            <select
              required
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
              value={formData.source_candidate_id}
              onChange={e => setFormData({ ...formData, source_candidate_id: e.target.value })}
            >
              {candidates.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">Outside Ad Title</label>
            <input
              required
              type="text"
              maxLength={200}
              placeholder="e.g. TV ad about taxes"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
              value={formData.source_title}
              onChange={e => setFormData({ ...formData, source_title: e.target.value })}
            />
          </div>

          <MediaUploadField
            candidateId={responderCandidateId}
            onMediaUrl={url => setFormData({ ...formData, source_media_url: url })}
            label="Upload or link the outside ad"
          />

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">What claim are you answering?</label>
            <textarea
              rows={3}
              maxLength={5000}
              placeholder="Briefly describe the claim, attack, or context for voters."
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors resize-none"
              value={formData.source_description}
              onChange={e => setFormData({ ...formData, source_description: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">Your Response</label>
            <textarea
              required
              rows={4}
              maxLength={5000}
              placeholder="Answer the claim directly with your explanation, evidence, or correction."
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors resize-none"
              value={formData.response_text}
              onChange={e => setFormData({ ...formData, response_text: e.target.value })}
            />
          </div>

          <MediaUploadField
            candidateId={responderCandidateId}
            onMediaUrl={url => setFormData({ ...formData, response_media_url: url })}
            label="Upload or link your response video/audio"
          />

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">Your Disclaimer</label>
            <input
              required
              type="text"
              maxLength={500}
              placeholder="Paid for by..."
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
              value={formData.disclaimer_text}
              onChange={e => setFormData({ ...formData, disclaimer_text: e.target.value })}
            />
          </div>

          <div className="pt-2 flex justify-end gap-3">
            <button type="button" onClick={() => onClose()} className="px-4 py-2 text-sm font-medium text-zinc-300 hover:text-white transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !formData.source_media_url || candidates.length === 0}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {submitting ? "Publishing..." : "Publish Side-by-Side Response"}
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
          <MediaUploadField candidateId={candidateId} onMediaUrl={setMediaUrl} label="Attach Rebuttal Media (video, image, audio)" />
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
