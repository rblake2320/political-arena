import { useState } from "react";
import { Link } from "react-router";
import {
  Swords, Megaphone, MessageSquare, Shield, Users, ChevronDown, ChevronRight,
  Vote, Newspaper, BarChart3, AlertTriangle, CheckCircle2, Clock, Flame,
  FileCheck2,
} from "lucide-react";

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function Section({ icon, title, children, defaultOpen = false }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-zinc-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-zinc-800/30 transition-colors"
      >
        <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center flex-shrink-0">
          {icon}
        </div>
        <span className="text-white font-semibold flex-1">{title}</span>
        {open ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronRight className="w-4 h-4 text-zinc-500" />}
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 text-sm text-zinc-400 leading-relaxed space-y-3 border-t border-zinc-800/50">
          {children}
        </div>
      )}
    </div>
  );
}

export function Help() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <div className="mb-10">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-3 bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
          How Arena Works
        </h1>
        <p className="text-zinc-400 text-lg leading-relaxed">
          Arena is a structured, transparent platform where political candidates debate issues publicly.
          Every claim can be challenged, answered, and backed by recites. Voters decide what matters.
        </p>
      </div>

      {/* Neutrality commitment — always visible */}
      <div style={{ border: '1px solid rgba(110,110,247,.35)', borderRadius: 14, background: 'linear-gradient(180deg,rgba(110,110,247,.07),rgba(110,110,247,.015))', padding: '20px 22px', marginBottom: 24 }}>
        <div style={{ font: "600 10px 'IBM Plex Mono',monospace", letterSpacing: '.18em', color: '#8F8FF9', marginBottom: 8 }}>WHERE ARENA STANDS</div>
        <p style={{ font: "400 15px/1.65 'Hanken Grotesk',sans-serif", color: '#D6D6DE', margin: 0 }}>
          Arena has no partisan lean. We don't take sides. Our only job is to keep the process fair and on the record —
          claims, sources, deadlines, and responses preserved as they happened, for every candidate equally.
          We know we won't get everything right. When we get something wrong, we'll correct it without delay and leave
          the correction on the record.
        </p>
      </div>

      <div className="space-y-3">
        {/* Overview */}
        <Section
          icon={<Shield className="w-4 h-4 text-indigo-400" />}
          title="Platform Overview"
          defaultOpen={true}
        >
          <p>
            Arena creates a level playing field for political races. Candidates run ads with mandatory FEC disclaimers,
            opponents get equal rebuttal slots, and voters issue public challenges that candidates must respond to or be marked as dodging.
          </p>
          <div className="grid grid-cols-2 gap-3 mt-2">
            <div className="p-3 bg-zinc-900/50 rounded-lg border border-zinc-800">
              <div className="text-white font-medium text-sm mb-1">For Voters</div>
              <div className="text-xs text-zinc-500">Ask questions, upvote issues, watch debates unfold in real time</div>
            </div>
            <div className="p-3 bg-zinc-900/50 rounded-lg border border-zinc-800">
              <div className="text-white font-medium text-sm mb-1">For Candidates</div>
              <div className="text-xs text-zinc-500">Run ads, respond to challenges, engage directly with constituents</div>
            </div>
            <div className="p-3 bg-zinc-900/50 rounded-lg border border-zinc-800">
              <div className="text-white font-medium text-sm mb-1">For Press</div>
              <div className="text-xs text-zinc-500">Submit questions with verified credentials, track candidate positions</div>
            </div>
            <div className="p-3 bg-zinc-900/50 rounded-lg border border-zinc-800">
              <div className="text-white font-medium text-sm mb-1">For Everyone</div>
              <div className="text-xs text-zinc-500">Full transparency — every ad, challenge, and response is public record</div>
            </div>
          </div>
        </Section>

        {/* Challenges */}
        <Section icon={<Swords className="w-4 h-4 text-amber-400" />} title="Challenges">
          <p>
            <strong className="text-white">Challenges</strong> are the core of Arena. One candidate publicly challenges
            another on a specific issue. Fact-check callouts must start with a recite so the claim is sourced before the countdown starts.
          </p>
          <div className="space-y-2 mt-2">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
              <span>Fact-check callouts require at least one source link, such as an official record, public document, reporting, or research</span>
            </div>
            <div className="flex items-start gap-2">
              <Clock className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
              <span>The target has <strong className="text-white">3 business days</strong> to respond publicly</span>
            </div>
            <div className="flex items-start gap-2">
              <FileCheck2 className="w-4 h-4 text-indigo-400 mt-0.5 flex-shrink-0" />
              <span>Each callout gets a public receipt showing the claim, recites, deadline, response status, and audit timeline</span>
            </div>
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" />
              <span>If they don't respond, the challenge is marked <strong className="text-orange-300">expired</strong> — voters see who dodged</span>
            </div>
            <div className="flex items-start gap-2">
              <Shield className="w-4 h-4 text-indigo-400 mt-0.5 flex-shrink-0" />
              <span>Cooldown limits prevent spam: one challenge per candidate pair per 24 hours</span>
            </div>
            <div className="flex items-start gap-2">
              <MessageSquare className="w-4 h-4 text-sky-400 mt-0.5 flex-shrink-0" />
              <span>Candidates can still attach uploaded or linked video, audio, and images for additional context</span>
            </div>
          </div>
        </Section>

        {/* Ads & Rebuttals */}
        <Section icon={<Megaphone className="w-4 h-4 text-blue-400" />} title="Ads & Rebuttals">
          <p>
            <strong className="text-white">Campaign Ads</strong> are paid content from candidates with mandatory FEC disclaimers.
            Arena ensures fairness through a rebuttal system.
          </p>
          <div className="space-y-2 mt-2">
            <div className="flex items-start gap-2">
              <Megaphone className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
              <span>Candidates can answer outside TV or digital ads by placing the original claim beside their response</span>
            </div>
            <div className="flex items-start gap-2">
              <Swords className="w-4 h-4 text-purple-400 mt-0.5 flex-shrink-0" />
              <span><strong className="text-white">Rebuttal slots</strong> — opposing candidates can claim a rebuttal slot on any ad, displayed side-by-side</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
              <span>Voters see both the original ad and the rebuttal together — no one gets the last word unchallenged</span>
            </div>
            <div className="flex items-start gap-2">
              <FileCheck2 className="w-4 h-4 text-indigo-400 mt-0.5 flex-shrink-0" />
              <span>Each side can add recites so claims are tied back to official records, documents, reporting, or research</span>
            </div>
          </div>
        </Section>

        {/* Questions */}
        <Section icon={<MessageSquare className="w-4 h-4 text-emerald-400" />} title="Voter & Press Questions">
          <p>
            <strong className="text-white">Questions</strong> let voters and press directly ask candidates about issues.
            The community votes to surface the most important ones.
          </p>
          <div className="space-y-2 mt-2">
            <div className="flex items-start gap-2">
              <Vote className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
              <span><strong className="text-white">Voter questions</strong> require voter verification. <strong className="text-white">Press questions</strong> require approved press credentials.</span>
            </div>
            <div className="flex items-start gap-2">
              <BarChart3 className="w-4 h-4 text-indigo-400 mt-0.5 flex-shrink-0" />
              <span>Questions are ranked by upvotes — the <strong className="text-white">Top 5</strong> voter and Top 5 press questions are highlighted per race</span>
            </div>
            <div className="flex items-start gap-2">
              <MessageSquare className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
              <span>You can attach uploaded or linked video, audio, and images to questions for context</span>
            </div>
          </div>
        </Section>

        {/* Reactions */}
        <Section icon={<Flame className="w-4 h-4 text-orange-400" />} title="Reactions, Recites & Fact Scores">
          <p>
            React to challenges, ads, and responses to signal what resonates with you. Add recites when a claim needs a public source.
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            {[
              { label: "Agree", color: "text-emerald-400" },
              { label: "Disagree", color: "text-red-400" },
              { label: "Important", color: "text-amber-400" },
              { label: "Misleading", color: "text-orange-400" },
              { label: "Helpful", color: "text-blue-400" },
            ].map(r => (
              <span key={r.label} className={`px-3 py-1 rounded-full text-xs font-medium border border-zinc-700 ${r.color}`}>
                {r.label}
              </span>
            ))}
          </div>
          <p className="mt-2">
            Reactions are anonymous and visible to everyone. They help surface impactful content and flag misleading claims.
          </p>
          <div className="space-y-2 mt-2">
            <div className="flex items-start gap-2">
              <FileCheck2 className="w-4 h-4 text-indigo-400 mt-0.5 flex-shrink-0" />
              <span><strong className="text-white">Recites</strong> are source links that support, refute, or add context to a claim.</span>
            </div>
            <div className="flex items-start gap-2">
              <BarChart3 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
              <span>The fact score weighs recite stance, source type, and moderation status; moderators and admins can verify or reject pending recites.</span>
            </div>
            <div className="flex items-start gap-2">
              <Shield className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
              <span>Recites can include publication dates, access dates, archive links, and review notes so sources remain accountable over time.</span>
            </div>
          </div>
        </Section>

        <Section icon={<BarChart3 className="w-4 h-4 text-indigo-400" />} title="Trust Ledger Profiles">
          <p>
            Candidate public profiles collect the historical record voters need: public callouts, responses, no-response events,
            reviewed statements, source links, transcript links, and evasion scores.
          </p>
          <div className="space-y-2 mt-2">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
              <span>Statements can link to exact timestamps in video or transcript sources so voters can inspect context.</span>
            </div>
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
              <span>Evasion scores flag answers that are partial, unclear, or dodge the question over time.</span>
            </div>
          </div>
        </Section>

        {/* Trending */}
        <Section icon={<BarChart3 className="w-4 h-4 text-indigo-400" />} title="Trending & Activity Scores">
          <p>
            Races are ranked by an <strong className="text-white">activity score</strong> that combines challenges, ads, questions, and responses.
          </p>
          <div className="space-y-2 mt-2">
            <div className="flex items-start gap-2">
              <Flame className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" />
              <span><strong className="text-orange-300">Hot</strong> — races with 10+ activity items are marked as hot</span>
            </div>
            <div className="flex items-start gap-2">
              <BarChart3 className="w-4 h-4 text-indigo-400 mt-0.5 flex-shrink-0" />
              <span><strong className="text-indigo-300">Trending</strong> — the top 3 most active races get a trending badge</span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
              <span>Sort by Trending, Newest, or A-Z on the homepage to find races that interest you</span>
            </div>
          </div>
        </Section>

        {/* Roles */}
        <Section icon={<Users className="w-4 h-4 text-violet-400" />} title="User Roles & Verification">
          <p>Arena uses verified roles to ensure authentic participation:</p>
          <div className="space-y-2 mt-2">
            <div className="flex items-start gap-2">
              <Users className="w-4 h-4 text-zinc-400 mt-0.5 flex-shrink-0" />
              <span><strong className="text-white">Voter</strong> — basic account. Can view all content. Verified voters can submit questions and reactions; signed-in users can add recites.</span>
            </div>
            <div className="flex items-start gap-2">
              <Newspaper className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
              <span><strong className="text-white">Press</strong> — approved journalists can submit press questions with higher visibility.</span>
            </div>
            <div className="flex items-start gap-2">
              <Megaphone className="w-4 h-4 text-indigo-400 mt-0.5 flex-shrink-0" />
              <span><strong className="text-white">Candidate Staff</strong> — linked to a candidate. Can issue challenges, create ads, and respond on behalf of their candidate.</span>
            </div>
          </div>
        </Section>

        {/* Credits */}
        <Section icon={<CheckCircle2 className="w-4 h-4 text-emerald-400" />} title="Arena Credits">
          <p>
            Actions on Arena use a credit system to prevent spam and ensure quality engagement:
          </p>
          <div className="space-y-1 mt-2 text-xs">
            <div className="flex justify-between py-1 border-b border-zinc-800/50">
              <span>Issue a Challenge</span><span className="text-white">5 credits</span>
            </div>
            <div className="flex justify-between py-1 border-b border-zinc-800/50">
              <span>Run a Campaign Ad</span><span className="text-white">10 credits</span>
            </div>
            <div className="flex justify-between py-1 border-b border-zinc-800/50">
              <span>Submit a Rebuttal</span><span className="text-white">3 credits</span>
            </div>
            <div className="flex justify-between py-1">
              <span>New accounts start with</span><span className="text-emerald-400">50 credits</span>
            </div>
          </div>
        </Section>
      </div>

      {/* CTA */}
      <div className="mt-10 p-6 rounded-2xl border border-indigo-500/20 bg-indigo-950/20 text-center">
        <h3 className="text-lg font-semibold text-white mb-2">Ready to dive in?</h3>
        <p className="text-sm text-zinc-400 mb-4">Browse active races and see democracy in action.</p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors"
        >
          View Active Races
          <ChevronRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
