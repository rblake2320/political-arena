import { useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { CandidateContext } from "../App";
import * as api from "../api";
import { useArenaStore } from "../store";
import { useAuth } from "../stores/auth";
import { useIsMobile } from "../hooks/useIsMobile";

const mono = "'IBM Plex Mono', ui-monospace, monospace";
const display = "'Space Grotesk', system-ui, sans-serif";
const serif = "'Instrument Serif', ui-serif, Georgia, serif";

const isDem = (p?: string) => /^dem/i.test(p || "");
const isRep = (p?: string) => /^rep/i.test(p || "");
const partyC = (p?: string) => isDem(p)
  ? { text: "#4D8AF0", ring: "rgba(77,138,240,.65)", grad: "linear-gradient(145deg,#1C2C4E,#101A30)", soft: "#7FA8F5", bar: "#4D8AF0" }
  : isRep(p)
    ? { text: "#E5636A", ring: "rgba(229,72,77,.6)", grad: "linear-gradient(145deg,#4A1D22,#2A1114)", soft: "#F08085", bar: "#E5484D" }
    : { text: "#9B9BAB", ring: "rgba(255,255,255,.25)", grad: "linear-gradient(145deg,#25252E,#16161C)", soft: "#C7C7D2", bar: "#6E6EF7" };
const initials = (n?: string) => (n || "").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("") || "-";
const fmtDT = (iso?: string) => {
  const d = new Date((iso || "").replace(" ", "T"));
  if (isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase()} · ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })} ET`;
};
const errorText = (err: any) => err?.response?.data?.error || err?.response?.data?.data?.error || err?.message || "Request failed";

type Notice = { kind: "success" | "error"; text: string } | null;
type ActionKey = "claim" | "challenge" | "post-ad" | "outside-ad" | "question" | "challenge-action" | "rebuttal";

function Stat({ v, label, color = "#F2F2F7", align = "start" }: { v: ReactNode; label: string; color?: string; align?: string }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: align === "end" ? "flex-end" : "flex-start" }}>
      <span style={{ font: `600 20px ${display}`, color }}>{v}</span>
      <span style={{ font: `500 8.5px ${mono}`, letterSpacing: ".12em", color: "#5C5C6E" }}>{label}</span>
    </span>
  );
}

function ActionButton({
  children, onClick, type = "button", variant = "primary", disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
}) {
  const styles = {
    primary: { color: "#F2F2F7", background: "#6E6EF7", border: "1px solid rgba(143,143,249,.75)" },
    secondary: { color: "#F2F2F7", background: "rgba(255,255,255,.045)", border: "1px solid rgba(255,255,255,.13)" },
    danger: { color: "#FFE8E8", background: "rgba(229,72,77,.14)", border: "1px solid rgba(229,72,77,.45)" },
    ghost: { color: "#9B9BAB", background: "transparent", border: "1px solid rgba(255,255,255,.08)" },
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        ...styles,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? .55 : 1,
        borderRadius: 9,
        padding: "9px 13px",
        font: `700 10px ${mono}`,
        letterSpacing: ".11em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </button>
  );
}

function ModalFrame({ title, kicker, children, onClose }: { title: string; kicker?: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", padding: 18, background: "rgba(0,0,0,.78)", backdropFilter: "blur(10px)" }}>
      <div onClick={event => event.stopPropagation()} style={{ width: "min(760px, 100%)", maxHeight: "92vh", overflowY: "auto", border: "1px solid rgba(255,255,255,.12)", borderRadius: 18, background: "#0C0C13", boxShadow: "0 30px 90px rgba(0,0,0,.55)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, padding: "18px 22px", borderBottom: "1px solid rgba(255,255,255,.08)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {kicker && <span style={{ font: `600 9px ${mono}`, letterSpacing: ".16em", color: "#8F8FF9" }}>{kicker}</span>}
            <h2 style={{ margin: 0, font: `600 22px ${display}`, color: "#F2F2F7" }}>{title}</h2>
          </div>
          <button onClick={onClose} style={{ cursor: "pointer", border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.04)", color: "#9B9BAB", borderRadius: 8, width: 34, height: 34, fontSize: 20, lineHeight: "30px" }}>×</button>
        </div>
        <div style={{ padding: 22 }}>{children}</div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, required, placeholder, type = "text" }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; placeholder?: string; type?: string }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <span style={{ font: `600 10px ${mono}`, letterSpacing: ".12em", color: "#9B9BAB" }}>{label}{required ? " *" : ""}</span>
      <input
        type={type}
        required={required}
        value={value}
        placeholder={placeholder}
        onChange={event => onChange(event.target.value)}
        style={{ width: "100%", border: "1px solid rgba(255,255,255,.12)", borderRadius: 10, background: "#08080C", color: "#F2F2F7", padding: "11px 12px", font: "400 14px 'Hanken Grotesk', system-ui, sans-serif", outline: "none" }}
      />
    </label>
  );
}

function TextAreaField({ label, value, onChange, required, placeholder, rows = 4, maxLength }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; placeholder?: string; rows?: number; maxLength?: number }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <span style={{ font: `600 10px ${mono}`, letterSpacing: ".12em", color: "#9B9BAB" }}>{label}{required ? " *" : ""}</span>
      <textarea
        required={required}
        rows={rows}
        maxLength={maxLength}
        value={value}
        placeholder={placeholder}
        onChange={event => onChange(event.target.value)}
        style={{ width: "100%", border: "1px solid rgba(255,255,255,.12)", borderRadius: 10, background: "#08080C", color: "#F2F2F7", padding: "11px 12px", font: "400 14px/1.55 'Hanken Grotesk', system-ui, sans-serif", outline: "none", resize: "vertical" }}
      />
      {maxLength && <span style={{ alignSelf: "flex-end", font: `500 9px ${mono}`, color: "#5C5C6E" }}>{value.length}/{maxLength}</span>}
    </label>
  );
}

function SelectField({ label, value, onChange, children, required }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode; required?: boolean }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <span style={{ font: `600 10px ${mono}`, letterSpacing: ".12em", color: "#9B9BAB" }}>{label}{required ? " *" : ""}</span>
      <select
        required={required}
        value={value}
        onChange={event => onChange(event.target.value)}
        style={{ width: "100%", border: "1px solid rgba(255,255,255,.12)", borderRadius: 10, background: "#08080C", color: "#F2F2F7", padding: "11px 12px", font: "400 14px 'Hanken Grotesk', system-ui, sans-serif", outline: "none" }}
      >
        {children}
      </select>
    </label>
  );
}

function FormMessage({ notice }: { notice: Notice }) {
  if (!notice) return null;
  const color = notice.kind === "success" ? "#34C384" : "#E5636A";
  return (
    <div style={{ border: `1px solid ${color}55`, background: `${color}12`, color, borderRadius: 10, padding: "10px 12px", font: "500 13px 'Hanken Grotesk', system-ui, sans-serif" }}>
      {notice.text}
    </div>
  );
}

function ReciteChip({ r }: { r: any }) {
  const stance = (r.stance || r.status || "").toLowerCase();
  const c = stance.includes("support") ? "#34C384" : stance.includes("context") ? "#EFB643" : "#E5636A";
  const lbl = stance.includes("support") ? "SUPPORTS" : stance.includes("context") ? "CONTEXT" : "REFUTES";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, font: `500 10px ${mono}`, color: "#9B9BAB", border: "1px solid rgba(255,255,255,.1)", background: "rgba(255,255,255,.02)", padding: "5px 10px", borderRadius: 7 }}>
      ↗ RECITE · {(r.title || r.source_type || "SOURCE").toUpperCase().slice(0, 42)} · <span style={{ color: c }}>{lbl}</span>
    </span>
  );
}

function FactBar({ label, fs }: { label: string; fs?: any }) {
  const val = fs?.score ?? 50;
  const good = val >= 60;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ font: `600 8.5px ${mono}`, letterSpacing: ".12em", color: "#5C5C6E" }}>{label}</span>
      <div style={{ width: 76, height: 4, borderRadius: 2, background: "rgba(255,255,255,.08)", overflow: "hidden" }}><div style={{ width: `${Math.max(4, Math.min(100, val))}%`, height: "100%", background: good ? "linear-gradient(90deg,#EFB643,#34C384)" : "linear-gradient(90deg,#E5636A,#EFB643)" }} /></div>
      <span style={{ font: `600 11px ${mono}`, color: good ? "#34C384" : "#EFB643" }}>{val} · {(fs?.label || "MIXED").toUpperCase().replace(/_/g, "-")}</span>
    </div>
  );
}

function EmptyPanel({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return (
    <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, background: "#0C0C13", padding: 24, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18, flexWrap: "wrap" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ font: `600 17px ${display}`, color: "#F2F2F7" }}>{title}</span>
        <span style={{ font: "400 13px/1.55 'Hanken Grotesk', system-ui, sans-serif", color: "#9B9BAB", maxWidth: 660 }}>{detail}</span>
      </div>
      {action}
    </div>
  );
}

function CalloutCard({
  ch, cands, responses, activeCandidateId, onAction,
}: {
  ch: any;
  cands: any[];
  responses: any[];
  activeCandidateId: string | null;
  onAction: (challenge: any) => void;
}) {
  const challenger = cands.find(c => c.id === ch.challenger_candidate_id);
  const target = cands.find(c => c.id === ch.target_candidate_id);
  const resp = responses.find(r => r.challenge_id === ch.id);
  const respCand = resp && cands.find(c => c.id === resp.candidate_id);
  const crs = ch.challenge_recite_summary || {};
  const responded = ch.status === "responded";
  const openForStaff = ch.status === "open" && activeCandidateId && [ch.target_candidate_id, ch.challenger_candidate_id].includes(activeCandidateId);
  const statusPill = responded ? { t: "RESPONDED · ON TIME", c: "#34C384" } : ch.status === "expired" ? { t: "NO RESPONSE", c: "#E5484D" } : ch.status === "refused" ? { t: "REFUSED", c: "#E5636A" } : { t: "AWAITING RESPONSE", c: "#EFB643" };
  const cc = partyC(challenger?.party), tc = partyC(target?.party);
  return (
    <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, background: "#0C0C13", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 22px", borderBottom: "1px solid rgba(255,255,255,.07)", background: "rgba(255,255,255,.015)", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ font: `600 10px ${mono}`, letterSpacing: ".14em", color: "#9B9BAB" }}>CALLOUT · {String(ch.public_receipt_slug || ch.id).toUpperCase()}</span>
          <span style={{ font: `700 8.5px ${mono}`, letterSpacing: ".12em", color: "#EFB643", background: "rgba(239,182,67,.09)", border: "1px solid rgba(239,182,67,.3)", padding: "3px 8px", borderRadius: 99 }}>{(ch.challenge_type || "FACT CHECK").toUpperCase().replace(/_/g, " ")}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {openForStaff && <ActionButton onClick={() => onAction(ch)} variant="secondary">Act</ActionButton>}
          <span style={{ font: `700 8.5px ${mono}`, letterSpacing: ".12em", color: statusPill.c, background: `${statusPill.c}17`, border: `1px solid ${statusPill.c}4d`, padding: "3px 8px", borderRadius: 99, whiteSpace: "nowrap" }}>{statusPill.t}</span>
        </div>
      </div>
      <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: cc.grad, border: `1.5px solid ${cc.ring}`, display: "flex", alignItems: "center", justifyContent: "center", font: `600 10.5px ${display}`, color: cc.soft }}>{initials(challenger?.name)}</div>
          <span style={{ font: `600 13px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }}>{challenger?.name?.split(/\s+/).slice(-1)[0] || "Campaign"}</span>
          <span style={{ color: "#5C5C6E" }}>→</span>
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: tc.grad, border: `1.5px solid ${tc.ring}`, display: "flex", alignItems: "center", justifyContent: "center", font: `600 10.5px ${display}`, color: tc.soft }}>{initials(target?.name)}</div>
          <span style={{ font: `600 13px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }}>{target?.name?.split(/\s+/).slice(-1)[0] || "Campaign"}</span>
          <span style={{ font: `500 10px ${mono}`, color: "#5C5C6E", marginLeft: "auto" }}>FILED {fmtDT(ch.created_at)}</span>
        </div>
        <div style={{ font: `italic 400 21px/1.45 ${serif}`, color: "#E8E8EF", borderLeft: "2px solid #EFB643", paddingLeft: 18 }}>"{ch.claim_text || ch.challenge_text}"</div>
        {crs.top_source && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><ReciteChip r={crs.top_source} />{crs.recite_count > 1 && <span style={{ font: `500 10px ${mono}`, color: "#5C5C6E", alignSelf: "center" }}>+{crs.recite_count - 1} more on receipt</span>}</div>}
        {resp && (
          <div style={{ border: "1px solid rgba(52,195,132,.22)", borderLeft: "3px solid #34C384", borderRadius: 12, background: "rgba(52,195,132,.04)", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: tc.grad, border: `1.5px solid ${tc.ring}`, display: "flex", alignItems: "center", justifyContent: "center", font: `600 9.5px ${display}`, color: tc.soft }}>{initials(respCand?.name)}</div>
              <span style={{ font: `600 12.5px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }}>{respCand?.name?.split(/\s+/).slice(-1)[0] || "Campaign"} responds</span>
              <span style={{ font: `500 9.5px ${mono}`, color: "#5C5C6E" }}>{fmtDT(resp.created_at)}</span>
            </div>
            <div style={{ font: `400 14px/1.65 'Hanken Grotesk',sans-serif`, color: "#C9C9D4" }}>{resp.response_text}</div>
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 22px", borderTop: "1px solid rgba(255,255,255,.07)", background: "rgba(255,255,255,.015)", flexWrap: "wrap", gap: 10 }}>
        <FactBar label="CLAIM FACT SCORE" fs={crs.fact_score} />
        <Link to={`/challenge/${ch.public_receipt_slug || ch.id}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, font: `600 12.5px 'Hanken Grotesk',sans-serif`, color: "#8F8FF9", textDecoration: "none" }}>View public receipt →</Link>
      </div>
    </div>
  );
}

export function Race() {
  const { id } = useParams();
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const { activeCandidateId, setActiveCandidateId } = useContext(CandidateContext);
  const { raceDetails, fetchRace } = useArenaStore();
  const [questions, setQuestions] = useState<any[]>([]);
  const [tab, setTab] = useState<"wire" | "callouts" | "ads" | "questions">("wire");
  const [action, setAction] = useState<ActionKey | null>(null);
  const [activeChallenge, setActiveChallenge] = useState<any | null>(null);
  const [activeAd, setActiveAd] = useState<any | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const race = id ? raceDetails[id] : null;

  const fetchQuestions = () => {
    if (!id) return;
    api.getQuestions(id).then(data => setQuestions((data?.questions ?? []) as any[])).catch(() => setQuestions([]));
  };

  const refresh = () => {
    if (id) fetchRace(id);
    fetchQuestions();
  };

  useEffect(() => {
    if (id) {
      fetchRace(id);
      fetchQuestions();
    }
  }, [id]);

  if (!race) return <div style={{ padding: 80, textAlign: "center", font: `400 13px ${mono}`, color: "#5C5C6E" }}>Loading race...</div>;

  const cands = race.candidates || [];
  const dem = cands.find(c => isDem(c.party)) || cands[0];
  const rep = cands.find(c => isRep(c.party)) || cands.find(c => c.id !== dem?.id);
  const activeCandidate = activeCandidateId ? cands.find((c: any) => c.id === activeCandidateId) : null;
  const isCandidateInRace = Boolean(user && activeCandidate);
  const challenges = race.challenges || [];
  const responses = race.challengeResponses || [];
  const ads = race.ads || [];
  const rebuttals = race.rebuttals || [];
  const level = /senate|house|president/i.test(race.office) ? "FEDERAL" : "STATE";
  const hasWire = challenges.length > 0 || ads.length > 0 || questions.length > 0;

  const statsFor = (c: any) => {
    if (!c) return { filed: 0, answered: 0, recites: 0, received: 0 };
    const filed = challenges.filter((x: any) => x.challenger_candidate_id === c.id).length;
    const received = challenges.filter((x: any) => x.target_candidate_id === c.id);
    const answered = received.filter((x: any) => x.status === "responded").length;
    const recites = challenges.filter((x: any) => x.challenger_candidate_id === c.id).reduce((s: number, x: any) => s + (x.challenge_recite_summary?.fact_score?.verified_count || 0), 0);
    return { filed, answered, received: received.length, recites };
  };
  const dS = statsFor(dem), rS = statsFor(rep);
  const TABS: [typeof tab, string, number | null][] = [["wire", "The Wire", null], ["callouts", "Callouts", challenges.length], ["ads", "Ads & Rebuttals", ads.length], ["questions", "Voter Questions", questions.length]];

  const closeModal = (shouldRefresh = false, success?: string) => {
    setAction(null);
    setActiveChallenge(null);
    setActiveAd(null);
    if (success) setNotice({ kind: "success", text: success });
    if (shouldRefresh) refresh();
  };

  const voteQuestion = async (questionId: string) => {
    try {
      const result = await api.voteQuestion(questionId);
      setQuestions(prev => prev.map(q => q.id === questionId ? { ...q, has_voted: result.voted, vote_count: result.vote_count } : q));
    } catch (err: any) {
      setNotice({ kind: "error", text: errorText(err) });
    }
  };

  const CandCol = ({ c, s, side }: { c: any; s: any; side: "l" | "r" }) => {
    const pc = partyC(c?.party);
    const av = <div style={{ flex: "none", width: 76, height: 76, borderRadius: "50%", background: pc.grad, border: `2px solid ${pc.ring}`, boxShadow: `0 0 34px ${pc.ring}`, display: "flex", alignItems: "center", justifyContent: "center", font: `600 22px ${display}`, color: pc.soft }}>{initials(c?.name)}</div>;
    const body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: side === "l" ? "flex-end" : "flex-start", textAlign: side === "l" ? "right" : "left" }}>
        <span style={{ font: `600 9.5px ${mono}`, letterSpacing: ".16em", color: pc.text }}>{(c?.party || "candidate").toUpperCase()}</span>
        <span style={{ font: `600 24px ${display}`, color: "#F2F2F7", lineHeight: 1.1 }}>{c?.name}</span>
        <span style={{ font: `400 12px/1.5 'Hanken Grotesk',sans-serif`, color: "#9B9BAB", maxWidth: 300 }}>{(c?.biography || "Campaign profile awaiting source-backed activity.").slice(0, 92)}</span>
        <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
          <Stat v={s.filed} label="CALLOUTS FILED" align={side === "l" ? "end" : "start"} />
          <Stat v={`${s.answered}/${s.received || 0}`} label="ANSWERED" color="#34C384" align={side === "l" ? "end" : "start"} />
          <Stat v={s.recites} label="RECITES VERIF" color="#34C384" align={side === "l" ? "end" : "start"} />
        </div>
      </div>
    );
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 18, justifyContent: side === "l" ? "flex-end" : "flex-start", padding: "22px 26px", border: `1px solid ${pc.ring}`, borderRadius: side === "l" ? "16px 4px 4px 16px" : "4px 16px 16px 4px", background: side === "l" ? `linear-gradient(270deg,${pc.ring},transparent)` : `linear-gradient(90deg,${pc.ring},transparent)` }}>
        {side === "l" ? <>{body}{av}</> : <>{av}{body}</>}
      </div>
    );
  };

  return (
    <div style={{ background: "#08080C", color: "#F2F2F7", fontFamily: "'Hanken Grotesk', system-ui, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: isMobile ? "12px 16px" : "14px 40px", borderBottom: "1px solid rgba(255,255,255,.06)", gap: 12 }}>
        <Link to="/" style={{ font: `500 12px 'Hanken Grotesk',sans-serif`, color: "#9B9BAB", textDecoration: "none" }}>‹ All races</Link>
        <span style={{ font: `500 9.5px ${mono}`, letterSpacing: ".12em", color: "#44444F", textAlign: "right" }}>RECORD ID · {String(race.id).toUpperCase()}</span>
      </div>

      <div style={{ padding: isMobile ? "34px 16px 28px" : "44px 40px 36px", borderBottom: "1px solid rgba(255,255,255,.08)", background: "linear-gradient(90deg,rgba(77,138,240,.09),transparent 32%,transparent 68%,rgba(229,72,77,.09)),#0A0A10" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "center", marginBottom: 24 }}>
          <span style={{ font: `600 10px ${mono}`, letterSpacing: ".16em", color: "#8F8FF9" }}>{race.state} · {level} · {(race.office || "").toUpperCase()}</span>
        </div>
        <div style={{ textAlign: "center", marginBottom: 34 }}>
          <div style={{ font: `400 ${isMobile ? 32 : 54}px/1.05 ${serif}`, color: "#F2F2F7" }}>{race.name}</div>
          {(race as any).description && <div style={{ marginTop: 12, font: `400 14px/1.6 'Hanken Grotesk',sans-serif`, color: "#9B9BAB", maxWidth: 640, margin: "12px auto 0" }}>{(race as any).description}</div>}
        </div>
        {dem && rep ? (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 120px 1fr", gap: isMobile ? 12 : 0, alignItems: "stretch", maxWidth: 1080, margin: "0 auto" }}>
            <CandCol c={dem} s={dS} side="l" />
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <span style={{ font: `italic 400 34px ${serif}`, color: "#5C5C6E" }}>vs</span>
              <span style={{ font: `600 8.5px ${mono}`, letterSpacing: ".18em", color: "#44444F" }}>{cands.filter((c: any) => c.verification_status === "verified").length} VERIFIED</span>
            </div>
            <CandCol c={rep} s={rS} side="r" />
          </div>
        ) : (
          <div style={{ maxWidth: 760, margin: "0 auto" }}>
            <EmptyPanel
              title="No claimed campaign profiles yet"
              detail="This race can go live as a neutral public reference record. Candidate speech and accountability clocks start only after a campaign registers or has a verified served-notice record."
              action={<ActionButton onClick={() => setAction("claim")}>Claim profile</ActionButton>}
            />
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: isMobile ? "0 12px" : "0 40px", borderBottom: "1px solid rgba(255,255,255,.08)", overflowX: "auto", whiteSpace: "nowrap" }}>
        {TABS.map(([k, label, n]) => (
          <button key={k} onClick={() => setTab(k)} style={{ flexShrink: 0, cursor: "pointer", background: "none", border: "none", font: `${tab === k ? 600 : 500} 13px 'Hanken Grotesk',sans-serif`, color: tab === k ? "#F2F2F7" : "#9B9BAB", padding: isMobile ? "14px 11px 12px" : "16px 16px 14px", borderBottom: tab === k ? "2px solid #6E6EF7" : "2px solid transparent", display: "inline-flex", alignItems: "center", gap: 7 }}>
            {label}{n != null && <span style={{ font: `600 9.5px ${mono}`, background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 99, padding: "2px 7px", color: "#9B9BAB" }}>{n}</span>}
          </button>
        ))}
      </div>

      <div style={{ padding: isMobile ? "16px 16px 0" : "20px 40px 0" }}>
        <div style={{ maxWidth: "none", border: "1px solid rgba(255,255,255,.1)", borderRadius: 14, background: "rgba(255,255,255,.025)", padding: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ font: `700 9.5px ${mono}`, letterSpacing: ".14em", color: "#8F8FF9" }}>STAFF ACTIONS</span>
            <span style={{ font: "400 12.5px/1.5 'Hanken Grotesk', system-ui, sans-serif", color: "#9B9BAB" }}>
              {isCandidateInRace ? `Acting as ${activeCandidate?.name}. Public actions are server-gated by campaign staff link.` : "Claim/register a campaign profile before issuing campaign speech or callouts."}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <ActionButton onClick={() => setAction("claim")} variant={isCandidateInRace ? "secondary" : "primary"}>{isCandidateInRace ? "Add profile" : "Claim profile"}</ActionButton>
            <ActionButton onClick={() => setAction("challenge")} disabled={!isCandidateInRace || cands.length < 2} variant="secondary">Issue callout</ActionButton>
            <ActionButton onClick={() => setAction("post-ad")} disabled={!isCandidateInRace} variant="secondary">Post ad</ActionButton>
            <ActionButton onClick={() => setAction("outside-ad")} disabled={!isCandidateInRace || cands.length < 2} variant="secondary">Answer outside ad</ActionButton>
            <ActionButton onClick={() => setAction("question")} variant="ghost">Ask question</ActionButton>
          </div>
        </div>
        {notice && <div style={{ marginTop: 12 }}><FormMessage notice={notice} /></div>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0,1fr) 332px", gap: isMobile ? 18 : 26, padding: isMobile ? "24px 16px 40px" : "30px 40px 44px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {tab === "wire" && !hasWire && (
            <EmptyPanel title="No public activity yet" detail="The race record is live. Callouts, ad pairs, rebuttals, and voter questions will appear here once campaigns and verified users participate." action={<ActionButton onClick={() => setAction(isCandidateInRace ? "challenge" : "claim")}>{isCandidateInRace ? "Issue callout" : "Claim profile"}</ActionButton>} />
          )}
          {tab === "callouts" && challenges.length === 0 && (
            <EmptyPanel title="No callouts filed" detail="Fact-check callouts require a specific claim and an initial source recite before any response clock starts." action={<ActionButton onClick={() => setAction("challenge")} disabled={!isCandidateInRace || cands.length < 2}>Issue callout</ActionButton>} />
          )}
          {(tab === "wire" || tab === "callouts") && challenges.map((ch: any) => (
            <CalloutCard
              key={ch.id}
              ch={ch}
              cands={cands}
              responses={responses}
              activeCandidateId={activeCandidateId}
              onAction={(challenge) => { setActiveChallenge(challenge); setAction("challenge-action"); }}
            />
          ))}
          {tab === "ads" && ads.length === 0 && (
            <EmptyPanel title="No ad pairs yet" detail="Campaign ads and outside-ad responses enter the review pipeline before they appear beside reserved rebuttal slots." action={<ActionButton onClick={() => setAction("post-ad")} disabled={!isCandidateInRace}>Post ad</ActionButton>} />
          )}
          {(tab === "wire" || tab === "ads") && ads.map((ad: any) => {
            const cand = cands.find((c: any) => c.id === ad.candidate_id);
            const pc = partyC(cand?.party);
            const reb = rebuttals.filter((r: any) => r.parent_ad_id === ad.id);
            const canClaimRebuttal = Boolean(isCandidateInRace && activeCandidateId && ad.candidate_id !== activeCandidateId && !reb.some((r: any) => r.candidate_id === activeCandidateId));
            return (
              <div key={ad.id} style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, background: "#0C0C13", overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 22px", borderBottom: "1px solid rgba(255,255,255,.07)", background: "rgba(255,255,255,.015)", gap: 12, flexWrap: "wrap" }}>
                  <span style={{ font: `600 10px ${mono}`, letterSpacing: ".14em", color: "#9B9BAB" }}>AD FLIGHT · {String(ad.id).toUpperCase()}</span>
                  <span style={{ font: `600 10px ${mono}`, letterSpacing: ".1em", color: "#5C5C6E" }}>SERVED AS A PAIRED UNIT — CLAIM + ANSWER</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr" }}>
                  <div style={{ padding: 22, borderRight: isMobile ? "none" : "1px solid rgba(255,255,255,.07)", borderBottom: isMobile ? "1px solid rgba(255,255,255,.07)" : "none", display: "flex", flexDirection: "column", gap: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 30, height: 30, borderRadius: "50%", background: pc.grad, border: `1.5px solid ${pc.ring}`, display: "flex", alignItems: "center", justifyContent: "center", font: `600 10.5px ${display}`, color: pc.soft }}>{initials(cand?.name)}</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}><span style={{ font: `600 13px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }}>{cand?.name || "Campaign"} campaign</span><span style={{ font: `500 9px ${mono}`, letterSpacing: ".1em", color: pc.text }}>{(cand?.party || "").toUpperCase().slice(0, 3)} · {ad.source_type === "external" ? "OUTSIDE AD" : "VERIFIED"}</span></div>
                    </div>
                    {ad.title && <div style={{ font: `600 19px/1.3 ${display}`, color: "#F2F2F7" }}>{ad.title}</div>}
                    <div style={{ font: `400 13.5px/1.65 'Hanken Grotesk',sans-serif`, color: "#C9C9D4" }}>{ad.ad_content_text}</div>
                    <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 7, border: "1px solid rgba(255,255,255,.1)", background: "rgba(255,255,255,.025)", borderRadius: 8, padding: "8px 12px" }}><span style={{ font: `500 9.5px ${mono}`, letterSpacing: ".1em", color: "#9B9BAB" }}>ⓘ {ad.disclaimer_text || "PAID FOR BY THE CAMPAIGN · MANDATORY DISCLAIMER"}</span></div>
                  </div>
                  <div style={{ padding: 22, background: "rgba(110,110,247,.025)", display: "flex", flexDirection: "column", gap: 10 }}>
                    <span style={{ font: `600 10px ${mono}`, letterSpacing: ".14em", color: "#8F8FF9" }}>◷ EQUAL TIME · REBUTTAL WINDOW</span>
                    {[0, 1, 2].map(i => {
                      const r = reb[i];
                      const rc = r && cands.find((c: any) => c.id === r.candidate_id);
                      return r ? (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, border: "1px solid rgba(52,195,132,.3)", background: "rgba(52,195,132,.05)", borderRadius: 10, padding: "12px 14px" }}>
                          <div style={{ width: 26, height: 26, borderRadius: "50%", background: partyC(rc?.party).grad, border: `1.5px solid ${partyC(rc?.party).ring}`, display: "flex", alignItems: "center", justifyContent: "center", font: `600 9.5px ${display}`, color: partyC(rc?.party).soft }}>{initials(rc?.name)}</div>
                          <span style={{ font: `600 12px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }}>Slot {i + 1} — {rc?.name?.split(/\s+/).slice(-1)[0]}</span>
                          <span style={{ marginLeft: "auto", font: `700 8.5px ${mono}`, letterSpacing: ".1em", color: "#34C384" }}>ANSWERED</span>
                        </div>
                      ) : (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, border: "1px dashed rgba(255,255,255,.16)", borderRadius: 10, padding: "12px 14px" }}>
                          <div style={{ width: 26, height: 26, borderRadius: "50%", border: "1.5px dashed rgba(255,255,255,.2)", display: "flex", alignItems: "center", justifyContent: "center", font: `600 11px ${display}`, color: "#5C5C6E" }}>{i + 1}</div>
                          <span style={{ font: `500 12px 'Hanken Grotesk',sans-serif`, color: "#9B9BAB" }}>Open — any opposing campaign</span>
                          {canClaimRebuttal ? <ActionButton onClick={() => { setActiveAd(ad); setAction("rebuttal"); }} variant="ghost">Claim</ActionButton> : <span style={{ marginLeft: "auto", font: `600 8.5px ${mono}`, letterSpacing: ".1em", color: "#5C5C6E" }}>OPEN</span>}
                        </div>
                      );
                    })}
                    <div style={{ marginTop: "auto", font: `400 11px/1.55 'Hanken Grotesk',sans-serif`, color: "#5C5C6E" }}>When an Arena ad goes live, opposing candidates get a reserved rebuttal window. Voters always see claim and answer together.</div>
                  </div>
                </div>
              </div>
            );
          })}
          {tab === "questions" && questions.length === 0 && (
            <EmptyPanel title="No questions yet" detail="Verified voters and approved press can ask questions. Top unanswered questions can later feed formal callout suggestions." action={<ActionButton onClick={() => setAction("question")}>Ask question</ActionButton>} />
          )}
          {(tab === "wire" || tab === "questions") && (
            <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, background: "#0C0C13", overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 22px", borderBottom: "1px solid rgba(255,255,255,.07)", background: "rgba(255,255,255,.015)", gap: 12 }}>
                <span style={{ font: `600 10px ${mono}`, letterSpacing: ".14em", color: "#9B9BAB" }}>VOTER QUESTIONS · RANKED BY UPVOTES</span>
                <ActionButton onClick={() => setAction("question")} variant="ghost">Submit</ActionButton>
              </div>
              {questions.length === 0 && <div style={{ padding: "22px", font: `400 13px 'Hanken Grotesk',sans-serif`, color: "#5C5C6E" }}>No questions yet — be the first to ask the candidates.</div>}
              {questions.map((q: any) => (
                <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 22px", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
                  <button onClick={() => voteQuestion(q.id)} style={{ cursor: "pointer", flex: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, border: `1px solid ${q.has_voted ? "rgba(52,195,132,.55)" : "rgba(110,110,247,.4)"}`, background: q.has_voted ? "rgba(52,195,132,.08)" : "rgba(110,110,247,.08)", borderRadius: 9, padding: "7px 12px" }}>
                    <span style={{ color: q.has_voted ? "#34C384" : "#8F8FF9" }}>▲</span><span style={{ font: `600 13px ${display}`, color: "#F2F2F7" }}>{q.vote_count ?? 0}</span>
                  </button>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ font: `500 14.5px/1.45 'Hanken Grotesk',sans-serif`, color: "#E8E8EF" }}>{q.question_text}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, font: `500 9.5px ${mono}`, letterSpacing: ".08em", color: "#5C5C6E" }}>
                      <span style={{ color: q.source_type === "press" ? "#8F8FF9" : "#5C5C6E" }}>{(q.source_type || "voter").toUpperCase()}{q.author_name ? ` · ${q.author_name.toUpperCase()}` : ""}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 14, background: "rgba(255,255,255,.02)", overflow: "hidden" }}>
            <div style={{ padding: "11px 16px", borderBottom: "1px solid rgba(255,255,255,.08)", font: `600 9.5px ${mono}`, letterSpacing: ".16em", color: "#5C5C6E" }}>RULES OF THIS ARENA</div>
            {[["RESPONSE SLA", "72 HOURS"], ["REBUTTAL WINDOW", "48 HOURS"], ["REBUTTAL SLOTS", "3 PER AD"], ["CALLOUT CAPS", "3 / DAY · 10 / WK"]].map(([k, v], i, a) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "11px 16px", borderBottom: i < a.length - 1 ? "1px solid rgba(255,255,255,.05)" : "none" }}><span style={{ font: `500 10.5px ${mono}`, color: "#9B9BAB" }}>{k}</span><span style={{ font: `600 10.5px ${mono}`, color: "#F2F2F7" }}>{v}</span></div>
            ))}
          </div>
          <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 14, background: "rgba(255,255,255,.02)", overflow: "hidden" }}>
            <div style={{ padding: "11px 16px", borderBottom: "1px solid rgba(255,255,255,.08)", font: `600 9.5px ${mono}`, letterSpacing: ".16em", color: "#5C5C6E" }}>TRUST LEDGER · THIS RACE</div>
            {[[dem, dS], [rep, rS]].filter(([c]) => c).map(([c, s]: any, i) => (
              <div key={c.id} style={{ padding: "14px 16px", borderBottom: i === 0 ? "1px solid rgba(255,255,255,.05)" : "none", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ font: `600 12px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }}>{c.name?.split(/\s+/).slice(-1)[0]}</span><span style={{ font: `600 11px ${mono}`, color: "#9B9BAB" }}>{s.received ? Math.round((s.answered / s.received) * 100) : 100}% ANS</span></div>
                <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,.07)", overflow: "hidden" }}><div style={{ width: `${s.received ? (s.answered / s.received) * 100 : 100}%`, height: "100%", background: partyC(c.party).bar }} /></div>
                <span style={{ font: `500 9px ${mono}`, letterSpacing: ".08em", color: "#5C5C6E" }}>{s.filed} FILED · {s.answered}/{s.received || 0} ANSWERED · {s.recites} RECITES VERIFIED</span>
              </div>
            ))}
            {cands.length === 0 && <div style={{ padding: "14px 16px", font: "400 12px/1.5 'Hanken Grotesk', system-ui, sans-serif", color: "#5C5C6E" }}>No campaign profiles have been claimed for this race.</div>}
          </div>
          <div style={{ border: "1px solid rgba(52,195,132,.25)", borderRadius: 14, background: "rgba(52,195,132,.04)", padding: "14px 16px", display: "flex", gap: 11, alignItems: "flex-start" }}>
            <span style={{ color: "#34C384", flex: "none" }}>◆</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ font: `600 11.5px 'Hanken Grotesk',sans-serif`, color: "#7BE0B2" }}>Tamper-evident record</span>
              <span style={{ font: `400 11px/1.55 'Hanken Grotesk',sans-serif`, color: "#9B9BAB" }}>Every action in this race is hash-chained in an append-only audit log. Verify any receipt independently.</span>
            </div>
          </div>
        </div>
      </div>

      {action === "claim" && id && <ClaimCandidateModal raceId={id} raceName={race.name} onCreated={(candidateId) => { setActiveCandidateId(candidateId); closeModal(true, "Campaign profile registered for review."); }} onClose={() => closeModal()} />}
      {action === "challenge" && id && activeCandidateId && <IssueChallengeModal raceId={id} challengerId={activeCandidateId} candidates={cands} onClose={(refreshNeeded, success) => closeModal(refreshNeeded, success)} />}
      {action === "post-ad" && id && activeCandidateId && <PostAdModal raceId={id} candidateId={activeCandidateId} onClose={(refreshNeeded, success) => closeModal(refreshNeeded, success)} />}
      {action === "outside-ad" && id && activeCandidateId && <OutsideAdModal raceId={id} responderId={activeCandidateId} candidates={cands} onClose={(refreshNeeded, success) => closeModal(refreshNeeded, success)} />}
      {action === "question" && id && <AskQuestionModal raceId={id} onClose={(refreshNeeded, success) => closeModal(refreshNeeded, success)} />}
      {action === "challenge-action" && activeChallenge && activeCandidateId && <ChallengeActionModal challenge={activeChallenge} activeCandidateId={activeCandidateId} onClose={(refreshNeeded, success) => closeModal(refreshNeeded, success)} />}
      {action === "rebuttal" && id && activeAd && activeCandidateId && <ClaimRebuttalModal ad={activeAd} raceId={id} candidateId={activeCandidateId} onClose={(refreshNeeded, success) => closeModal(refreshNeeded, success)} />}
    </div>
  );
}

function ClaimCandidateModal({ raceId, raceName, onCreated, onClose }: { raceId: string; raceName: string; onCreated: (candidateId: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [party, setParty] = useState("");
  const [biography, setBiography] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setNotice(null);
    try {
      const candidate = await api.createCandidate({
        race_id: raceId,
        name: name.trim(),
        party: party.trim(),
        biography: biography.trim() || undefined,
        website_url: websiteUrl.trim() || undefined,
      });
      onCreated(candidate.id);
    } catch (err: any) {
      setNotice({ kind: "error", text: errorText(err) });
      setSubmitting(false);
    }
  };

  return (
    <ModalFrame title="Claim campaign profile" kicker={raceName} onClose={onClose}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 15 }}>
        <FormMessage notice={notice} />
        <div style={{ border: "1px solid rgba(239,182,67,.28)", background: "rgba(239,182,67,.06)", color: "#D6B464", borderRadius: 10, padding: "10px 12px", font: "400 12.5px/1.5 'Hanken Grotesk', system-ui, sans-serif" }}>
          This creates a pending campaign profile and staff link. It does not mark the candidate as state ballot-certified.
        </div>
        <Field label="Candidate name" required value={name} onChange={setName} placeholder="Full candidate name" />
        <Field label="Party / affiliation" required value={party} onChange={setParty} placeholder="Democrat, Republican, Independent..." />
        <TextAreaField label="Short campaign bio" value={biography} onChange={setBiography} maxLength={5000} rows={4} />
        <Field label="Campaign website" value={websiteUrl} onChange={setWebsiteUrl} type="url" placeholder="https://..." />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <ActionButton onClick={onClose} variant="ghost">Cancel</ActionButton>
          <ActionButton type="submit" disabled={submitting}>{submitting ? "Saving" : "Register"}</ActionButton>
        </div>
      </form>
    </ModalFrame>
  );
}

function IssueChallengeModal({ raceId, challengerId, candidates, onClose }: { raceId: string; challengerId: string; candidates: any[]; onClose: (refresh?: boolean, success?: string) => void }) {
  const targets = candidates.filter(c => c.id !== challengerId);
  const [targetId, setTargetId] = useState(targets[0]?.id || "");
  const [challengeType, setChallengeType] = useState("fact_check");
  const [claimText, setClaimText] = useState("");
  const [challengeText, setChallengeText] = useState("");
  const [requestedResponse, setRequestedResponse] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [publisher, setPublisher] = useState("");
  const [sourceType, setSourceType] = useState("official_record");
  const [notice, setNotice] = useState<Notice>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setNotice(null);
    try {
      const factCheck = challengeType === "fact_check";
      await api.createChallenge({
        race_id: raceId,
        challenger_candidate_id: challengerId,
        target_candidate_id: targetId,
        challenge_type: challengeType,
        claim_text: claimText.trim() || undefined,
        challenge_text: challengeText.trim(),
        requested_response: requestedResponse.trim() || undefined,
        deadline_business_days: 3,
        initial_recites: factCheck ? [{
          url: sourceUrl.trim(),
          title: sourceTitle.trim(),
          publisher: publisher.trim() || undefined,
          source_type: sourceType as any,
          stance: "supports",
          claim_text: claimText.trim() || challengeText.trim(),
        }] : undefined,
      });
      onClose(true, "Callout filed. The receipt and response clock are now public.");
    } catch (err: any) {
      setNotice({ kind: "error", text: errorText(err) });
      setSubmitting(false);
    }
  };

  return (
    <ModalFrame title="Issue callout" kicker="Specific claim + source-backed record" onClose={() => onClose()}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 15 }}>
        <FormMessage notice={notice} />
        <SelectField label="Target campaign" required value={targetId} onChange={setTargetId}>
          {targets.map(c => <option key={c.id} value={c.id}>{c.name} ({c.party})</option>)}
        </SelectField>
        <SelectField label="Callout type" value={challengeType} onChange={setChallengeType}>
          <option value="fact_check">Fact-check callout</option>
          <option value="policy_question">Policy question</option>
          <option value="debate_request">Debate request</option>
          <option value="open">Open callout</option>
        </SelectField>
        <TextAreaField label="Specific claim" value={claimText} onChange={setClaimText} required={challengeType === "fact_check"} maxLength={500} rows={3} placeholder="Quote or summarize the claim being challenged." />
        <TextAreaField label="Challenge statement" value={challengeText} onChange={setChallengeText} required maxLength={2000} rows={5} placeholder="Explain what the target campaign should answer." />
        <TextAreaField label="Requested response" value={requestedResponse} onChange={setRequestedResponse} maxLength={500} rows={3} placeholder="What would answer this cleanly?" />
        {challengeType === "fact_check" && (
          <div style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 12, padding: 14, display: "grid", gap: 12 }}>
            <span style={{ font: `700 10px ${mono}`, letterSpacing: ".14em", color: "#34C384" }}>INITIAL RECITE REQUIRED</span>
            <Field label="Source title" required value={sourceTitle} onChange={setSourceTitle} />
            <Field label="Source URL" required type="url" value={sourceUrl} onChange={setSourceUrl} placeholder="https://..." />
            <Field label="Publisher" value={publisher} onChange={setPublisher} />
            <SelectField label="Source type" value={sourceType} onChange={setSourceType}>
              <option value="official_record">Official record</option>
              <option value="public_document">Public document</option>
              <option value="court_record">Court record</option>
              <option value="research">Research</option>
              <option value="news">News</option>
              <option value="campaign_material">Campaign material</option>
              <option value="other">Other</option>
            </SelectField>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <ActionButton onClick={() => onClose()} variant="ghost">Cancel</ActionButton>
          <ActionButton type="submit" disabled={submitting || !targetId}>{submitting ? "Filing" : "Issue callout"}</ActionButton>
        </div>
      </form>
    </ModalFrame>
  );
}

function ChallengeActionModal({ challenge, activeCandidateId, onClose }: { challenge: any; activeCandidateId: string; onClose: (refresh?: boolean, success?: string) => void }) {
  const canRespond = activeCandidateId === challenge.target_candidate_id;
  const canWithdraw = activeCandidateId === challenge.challenger_candidate_id;
  const [mode, setMode] = useState<"respond" | "refuse" | "withdraw">(canRespond ? "respond" : "withdraw");
  const [responseText, setResponseText] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [refusalReason, setRefusalReason] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setNotice(null);
    try {
      if (mode === "respond") {
        await api.respondToChallenge(challenge.id, { response_text: responseText.trim(), media_url: mediaUrl.trim() || undefined });
        onClose(true, "Response posted to the public receipt.");
      } else if (mode === "refuse") {
        await api.refuseChallenge(challenge.id, { refusal_reason: refusalReason.trim() || undefined });
        onClose(true, "Refusal recorded on the public receipt.");
      } else {
        await api.withdrawChallenge(challenge.id);
        onClose(true, "Callout withdrawn and credit refunded.");
      }
    } catch (err: any) {
      setNotice({ kind: "error", text: errorText(err) });
      setSubmitting(false);
    }
  };

  return (
    <ModalFrame title="Act on callout" kicker={String(challenge.public_receipt_slug || challenge.id).toUpperCase()} onClose={() => onClose()}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 15 }}>
        <FormMessage notice={notice} />
        <div style={{ font: `italic 400 20px/1.4 ${serif}`, color: "#E8E8EF", borderLeft: "2px solid #EFB643", paddingLeft: 16 }}>"{challenge.claim_text || challenge.challenge_text}"</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {canRespond && <ActionButton onClick={() => setMode("respond")} variant={mode === "respond" ? "primary" : "secondary"}>Respond</ActionButton>}
          {canRespond && <ActionButton onClick={() => setMode("refuse")} variant={mode === "refuse" ? "danger" : "secondary"}>Refuse</ActionButton>}
          {canWithdraw && <ActionButton onClick={() => setMode("withdraw")} variant={mode === "withdraw" ? "danger" : "secondary"}>Withdraw</ActionButton>}
        </div>
        {mode === "respond" && (
          <>
            <TextAreaField label="Public response" required value={responseText} onChange={setResponseText} maxLength={5000} rows={6} />
            <Field label="Response media URL" type="url" value={mediaUrl} onChange={setMediaUrl} placeholder="https://..." />
          </>
        )}
        {mode === "refuse" && <TextAreaField label="Refusal reason" value={refusalReason} onChange={setRefusalReason} maxLength={1000} rows={4} />}
        {mode === "withdraw" && <div style={{ color: "#D6B464", font: "400 13px/1.55 'Hanken Grotesk', system-ui, sans-serif" }}>Withdrawing an open callout removes it from the active clock and refunds the callout credit.</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <ActionButton onClick={() => onClose()} variant="ghost">Cancel</ActionButton>
          <ActionButton type="submit" disabled={submitting || (mode === "respond" && responseText.trim().length === 0)} variant={mode === "respond" ? "primary" : "danger"}>{submitting ? "Saving" : mode}</ActionButton>
        </div>
      </form>
    </ModalFrame>
  );
}

function PostAdModal({ raceId, candidateId, onClose }: { raceId: string; candidateId: string; onClose: (refresh?: boolean, success?: string) => void }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [disclaimer, setDisclaimer] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setNotice(null);
    try {
      await api.createAd({
        race_id: raceId,
        candidate_id: candidateId,
        title: title.trim(),
        ad_content_text: content.trim(),
        disclaimer_text: disclaimer.trim(),
        media_url: mediaUrl.trim() || undefined,
        media_type: mediaUrl.trim() ? "video" : "text",
      });
      onClose(true, "Ad draft created for moderation.");
    } catch (err: any) {
      setNotice({ kind: "error", text: errorText(err) });
      setSubmitting(false);
    }
  };

  return (
    <ModalFrame title="Post campaign ad" kicker="Creates moderated ad draft" onClose={() => onClose()}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 15 }}>
        <FormMessage notice={notice} />
        <Field label="Ad title" required value={title} onChange={setTitle} />
        <TextAreaField label="Ad text / transcript" required value={content} onChange={setContent} maxLength={5000} rows={6} />
        <Field label="Media URL" value={mediaUrl} onChange={setMediaUrl} type="url" placeholder="https://..." />
        <TextAreaField label="FEC disclaimer" required value={disclaimer} onChange={setDisclaimer} maxLength={500} rows={3} placeholder="Paid for by..." />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <ActionButton onClick={() => onClose()} variant="ghost">Cancel</ActionButton>
          <ActionButton type="submit" disabled={submitting}>{submitting ? "Creating" : "Create draft"}</ActionButton>
        </div>
      </form>
    </ModalFrame>
  );
}

function OutsideAdModal({ raceId, responderId, candidates, onClose }: { raceId: string; responderId: string; candidates: any[]; onClose: (refresh?: boolean, success?: string) => void }) {
  const sourceCandidates = candidates.filter(c => c.id !== responderId);
  const [sourceCandidateId, setSourceCandidateId] = useState(sourceCandidates[0]?.id || "");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceMediaUrl, setSourceMediaUrl] = useState("");
  const [sourceDescription, setSourceDescription] = useState("");
  const [responseText, setResponseText] = useState("");
  const [disclaimer, setDisclaimer] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setNotice(null);
    try {
      await api.createExternalAdResponse({
        race_id: raceId,
        source_candidate_id: sourceCandidateId,
        responder_candidate_id: responderId,
        source_title: sourceTitle.trim(),
        source_media_url: sourceMediaUrl.trim(),
        source_description: sourceDescription.trim() || undefined,
        response_text: responseText.trim(),
        disclaimer_text: disclaimer.trim(),
      });
      onClose(true, "Outside-ad response created for moderation.");
    } catch (err: any) {
      setNotice({ kind: "error", text: errorText(err) });
      setSubmitting(false);
    }
  };

  return (
    <ModalFrame title="Answer outside ad" kicker="Original claim + campaign response" onClose={() => onClose()}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 15 }}>
        <FormMessage notice={notice} />
        <SelectField label="Candidate behind outside ad" required value={sourceCandidateId} onChange={setSourceCandidateId}>
          {sourceCandidates.map(c => <option key={c.id} value={c.id}>{c.name} ({c.party})</option>)}
        </SelectField>
        <Field label="Outside ad title" required value={sourceTitle} onChange={setSourceTitle} />
        <Field label="Outside ad media/source URL" required type="url" value={sourceMediaUrl} onChange={setSourceMediaUrl} />
        <TextAreaField label="Context / source description" value={sourceDescription} onChange={setSourceDescription} maxLength={5000} rows={4} />
        <TextAreaField label="Your response" required value={responseText} onChange={setResponseText} maxLength={5000} rows={5} />
        <TextAreaField label="FEC disclaimer" required value={disclaimer} onChange={setDisclaimer} maxLength={500} rows={3} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <ActionButton onClick={() => onClose()} variant="ghost">Cancel</ActionButton>
          <ActionButton type="submit" disabled={submitting || !sourceCandidateId}>{submitting ? "Creating" : "Create response"}</ActionButton>
        </div>
      </form>
    </ModalFrame>
  );
}

function ClaimRebuttalModal({ ad, raceId, candidateId, onClose }: { ad: any; raceId: string; candidateId: string; onClose: (refresh?: boolean, success?: string) => void }) {
  const [responseText, setResponseText] = useState("");
  const [disclaimer, setDisclaimer] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setNotice(null);
    try {
      await api.createRebuttal({
        parent_ad_id: ad.id,
        race_id: raceId,
        candidate_id: candidateId,
        response_text: responseText.trim(),
        disclaimer_text: disclaimer.trim(),
        media_url: mediaUrl.trim() || undefined,
      });
      onClose(true, "Rebuttal draft created for moderation.");
    } catch (err: any) {
      setNotice({ kind: "error", text: errorText(err) });
      setSubmitting(false);
    }
  };

  return (
    <ModalFrame title="Claim rebuttal slot" kicker={String(ad.title || ad.id).toUpperCase()} onClose={() => onClose()}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 15 }}>
        <FormMessage notice={notice} />
        <TextAreaField label="Rebuttal response" required value={responseText} onChange={setResponseText} maxLength={5000} rows={6} />
        <Field label="Media URL" value={mediaUrl} onChange={setMediaUrl} type="url" placeholder="https://..." />
        <TextAreaField label="FEC disclaimer" required value={disclaimer} onChange={setDisclaimer} maxLength={500} rows={3} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <ActionButton onClick={() => onClose()} variant="ghost">Cancel</ActionButton>
          <ActionButton type="submit" disabled={submitting}>{submitting ? "Submitting" : "Submit rebuttal"}</ActionButton>
        </div>
      </form>
    </ModalFrame>
  );
}

function AskQuestionModal({ raceId, onClose }: { raceId: string; onClose: (refresh?: boolean, success?: string) => void }) {
  const [sourceType, setSourceType] = useState("voter");
  const [questionText, setQuestionText] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setNotice(null);
    try {
      await api.submitQuestion(raceId, {
        source_type: sourceType,
        question_text: questionText.trim(),
        media_url: mediaUrl.trim() || undefined,
      });
      onClose(true, "Question submitted.");
    } catch (err: any) {
      setNotice({ kind: "error", text: errorText(err) });
      setSubmitting(false);
    }
  };

  return (
    <ModalFrame title="Ask a question" kicker="Verified voter or approved press" onClose={() => onClose()}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 15 }}>
        <FormMessage notice={notice} />
        <SelectField label="Question source" value={sourceType} onChange={setSourceType}>
          <option value="voter">Verified voter</option>
          <option value="press">Approved press</option>
        </SelectField>
        <TextAreaField label="Question" required value={questionText} onChange={setQuestionText} maxLength={2000} rows={5} placeholder="What should candidates address on the record?" />
        <Field label="Supporting media URL" value={mediaUrl} onChange={setMediaUrl} type="url" placeholder="https://..." />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <ActionButton onClick={() => onClose()} variant="ghost">Cancel</ActionButton>
          <ActionButton type="submit" disabled={submitting || questionText.trim().length < 10}>{submitting ? "Submitting" : "Submit question"}</ActionButton>
        </div>
      </form>
    </ModalFrame>
  );
}
