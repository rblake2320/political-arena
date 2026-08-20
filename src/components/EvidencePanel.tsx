import { useEffect, useState } from "react";
import * as api from "../api";
import { useAuth } from "../stores/auth";

/**
 * Evidence & fact-check panel for one side of a paired unit (an ad or a
 * rebuttal). This is where the public "comments" on Arena — not free-text
 * threads, but structured, moderated accountability:
 *  - recites: sourced citations that SUPPORT / REFUTE / add CONTEXT, from
 *    anyone signed in (they enter the moderation queue as pending)
 *  - reactions: verified-voter signals (helpful / misleading / …)
 *  - correction requests: formal appeals routed to the moderation queue
 */

const mono = "'IBM Plex Mono', ui-monospace, monospace";

const STANCE_COLORS: Record<string, string> = {
  supports: "#34C384",
  refutes: "#E5636A",
  context: "#EFB643",
};

const REACTIONS: [string, string][] = [
  ["helpful", "Helpful"],
  ["misleading", "Misleading"],
  ["agree", "Agree"],
  ["disagree", "Disagree"],
  ["important", "Important"],
];

function scoreColor(score: number) {
  if (score >= 70) return "#34C384";
  if (score >= 45) return "#EFB643";
  return "#E5636A";
}

export function EvidencePanel({ contentType, contentId, sideLabel }: { contentType: "ad" | "rebuttal"; contentId: string; sideLabel: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [recites, setRecites] = useState<any[]>([]);
  const [factScore, setFactScore] = useState<any>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [mine, setMine] = useState<Record<string, string>>({}); // reaction_type -> reaction id
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showCorrection, setShowCorrection] = useState(false);
  const [form, setForm] = useState({ url: "", title: "", stance: "refutes", quote: "" });
  const [correction, setCorrection] = useState("");

  const load = async () => {
    try {
      const [r, c] = await Promise.all([
        api.getRecites(contentType, contentId),
        api.getReactions(contentType, contentId),
      ]);
      setRecites(r.recites || []);
      setFactScore(r.fact_score || null);
      setCounts(c.counts || {});
      if (user) {
        const m = await api.getMyReactions(contentType, contentId).catch(() => null);
        const map: Record<string, string> = {};
        for (const row of m?.reactions || []) map[row.reaction_type] = row.id;
        setMine(map);
      }
    } catch { /* target may have no recites yet */ }
    setLoaded(true);
  };

  useEffect(() => {
    if (open && !loaded) void load();
  }, [open]);

  const toggleReaction = async (type: string) => {
    if (!user) { setMsg("Sign in to react."); return; }
    setBusy(true);
    setMsg("");
    try {
      if (mine[type]) {
        await api.removeReaction(mine[type]);
      } else {
        await api.addReaction({ content_type: contentType, content_id: contentId, reaction_type: type });
      }
      await load();
    } catch (err: any) {
      setMsg(err?.response?.data?.error || "Reactions require a verified voter account.");
    } finally {
      setBusy(false);
    }
  };

  const submitRecite = async () => {
    setBusy(true);
    setMsg("");
    try {
      await api.addRecite({
        content_type: contentType,
        content_id: contentId,
        url: form.url.trim(),
        title: form.title.trim(),
        stance: form.stance as any,
        quote: form.quote.trim() || undefined,
      });
      setForm({ url: "", title: "", stance: "refutes", quote: "" });
      setShowAdd(false);
      setMsg("Source submitted — it appears as PENDING until a moderator verifies it.");
      await load();
    } catch (err: any) {
      setMsg(err?.response?.data?.error || "Could not submit the source.");
    } finally {
      setBusy(false);
    }
  };

  const submitCorrection = async () => {
    setBusy(true);
    setMsg("");
    try {
      await api.submitCorrection({ content_type: contentType, content_id: contentId, requested_change: correction.trim() });
      setCorrection("");
      setShowCorrection(false);
      setMsg("Correction request filed — it enters the moderation queue with a public ruling to follow.");
    } catch (err: any) {
      setMsg(err?.response?.data?.error || "Could not file the correction request.");
    } finally {
      setBusy(false);
    }
  };

  const verified = recites.filter(r => r.status === "verified").length;
  const inputStyle: React.CSSProperties = { background: "#08080C", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8, padding: "8px 10px", font: "400 12px 'Hanken Grotesk',sans-serif", color: "#F2F2F7", width: "100%" };

  return (
    <div style={{ borderTop: "1px dashed rgba(255,255,255,.1)", marginTop: 10 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ cursor: "pointer", width: "100%", background: "none", border: "none", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", font: `600 10px ${mono}`, letterSpacing: ".12em", color: "#8F8FF9" }}
      >
        <span>◈ FACT-CHECK & EVIDENCE · {sideLabel}</span>
        <span style={{ color: "#5C5C6E" }}>{open ? "▴ CLOSE" : `▾ ${loaded ? `${recites.length} SOURCE${recites.length === 1 ? "" : "S"}` : "OPEN"}`}</span>
      </button>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingBottom: 12 }}>
          {factScore && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ font: `600 9px ${mono}`, letterSpacing: ".12em", color: "#5C5C6E" }}>FACT SCORE</span>
              <span style={{ font: `700 13px ${mono}`, color: scoreColor(factScore.score ?? 50) }}>{factScore.score ?? 50}</span>
              <span style={{ font: `600 8.5px ${mono}`, letterSpacing: ".1em", color: "#5C5C6E" }}>{String(factScore.label || "").toUpperCase()} · {verified} VERIFIED / {recites.length} FILED</span>
            </div>
          )}

          {recites.length === 0 && loaded && (
            <div style={{ font: "400 12px 'Hanken Grotesk',sans-serif", color: "#5C5C6E" }}>No sources filed on this side yet. Be the first to put evidence on the record.</div>
          )}
          {recites.map(r => (
            <div key={r.id} style={{ borderLeft: `2px solid ${STANCE_COLORS[r.stance] || "#9B9BAB"}`, paddingLeft: 10, display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ font: `700 8.5px ${mono}`, letterSpacing: ".1em", color: STANCE_COLORS[r.stance] || "#9B9BAB" }}>{String(r.stance).toUpperCase()}</span>
                <span style={{ font: `600 8.5px ${mono}`, letterSpacing: ".08em", color: r.status === "verified" ? "#34C384" : r.status === "rejected" ? "#E5636A" : "#EFB643" }}>{String(r.status).toUpperCase()}</span>
              </div>
              <a href={r.url} target="_blank" rel="noreferrer" style={{ font: "600 12.5px 'Hanken Grotesk',sans-serif", color: "#F2F2F7", textDecoration: "none" }}>{r.title} ↗</a>
              {r.quote && <span style={{ font: "italic 400 11.5px 'Hanken Grotesk',sans-serif", color: "#9B9BAB" }}>“{r.quote}”</span>}
            </div>
          ))}

          {/* reactions — verified-voter signals */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {REACTIONS.map(([type, label]) => {
              const active = !!mine[type];
              const count = counts[type] || 0;
              const danger = type === "misleading" || type === "disagree";
              const c = active ? (danger ? "#E5636A" : "#34C384") : "#9B9BAB";
              return (
                <button key={type} disabled={busy} onClick={() => toggleReaction(type)}
                  style={{ cursor: "pointer", font: `600 10px 'Hanken Grotesk',sans-serif`, color: c, background: `${c}${active ? "1a" : "0d"}`, border: `1px solid ${c}${active ? "66" : "33"}`, padding: "5px 10px", borderRadius: 99 }}>
                  {label}{count > 0 ? ` · ${count}` : ""}
                </button>
              );
            })}
          </div>

          {/* actions */}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <button onClick={() => { setShowAdd(a => !a); setShowCorrection(false); }} style={{ cursor: "pointer", background: "none", border: "none", font: `600 11px 'Hanken Grotesk',sans-serif`, color: "#8F8FF9", padding: 0 }}>
              {showAdd ? "− Cancel" : "+ Add a fact-check source"}
            </button>
            <button onClick={() => { setShowCorrection(c => !c); setShowAdd(false); }} style={{ cursor: "pointer", background: "none", border: "none", font: `600 11px 'Hanken Grotesk',sans-serif`, color: "#EFB643", padding: 0 }}>
              {showCorrection ? "− Cancel" : "⚑ Request a correction"}
            </button>
          </div>

          {showAdd && (
            !user ? <div style={{ font: "400 12px 'Hanken Grotesk',sans-serif", color: "#9B9BAB" }}>Sign in to file evidence. Every source is reviewed by moderators before it counts toward the fact score.</div> :
            <div style={{ display: "flex", flexDirection: "column", gap: 8, border: "1px solid rgba(255,255,255,.1)", borderRadius: 10, padding: 12, background: "rgba(255,255,255,.02)" }}>
              <select value={form.stance} onChange={e => setForm({ ...form, stance: e.target.value })} style={inputStyle}>
                <option value="refutes">This source REFUTES this side</option>
                <option value="supports">This source SUPPORTS this side</option>
                <option value="context">This source adds CONTEXT</option>
              </select>
              <input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="Source URL (https://…)" style={inputStyle} />
              <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Source title" style={inputStyle} />
              <input value={form.quote} onChange={e => setForm({ ...form, quote: e.target.value })} placeholder="Key quote (optional)" style={inputStyle} />
              <button disabled={busy || !form.url.trim() || !form.title.trim()} onClick={submitRecite}
                style={{ cursor: "pointer", opacity: busy || !form.url.trim() || !form.title.trim() ? 0.5 : 1, font: "700 11px 'Hanken Grotesk',sans-serif", color: "#08080C", background: "#8F8FF9", border: "none", padding: "9px 14px", borderRadius: 8, alignSelf: "flex-start" }}>
                File source for review
              </button>
            </div>
          )}

          {showCorrection && (
            !user ? <div style={{ font: "400 12px 'Hanken Grotesk',sans-serif", color: "#9B9BAB" }}>Sign in to request a correction.</div> :
            <div style={{ display: "flex", flexDirection: "column", gap: 8, border: "1px solid rgba(239,182,67,.3)", borderRadius: 10, padding: 12, background: "rgba(239,182,67,.04)" }}>
              <textarea value={correction} onChange={e => setCorrection(e.target.value)} rows={3} placeholder="What is wrong on this side, and what should the corrected record say? (min 10 characters)" style={inputStyle} />
              <button disabled={busy || correction.trim().length < 10} onClick={submitCorrection}
                style={{ cursor: "pointer", opacity: busy || correction.trim().length < 10 ? 0.5 : 1, font: "700 11px 'Hanken Grotesk',sans-serif", color: "#08080C", background: "#EFB643", border: "none", padding: "9px 14px", borderRadius: 8, alignSelf: "flex-start" }}>
                File correction request
              </button>
            </div>
          )}

          {msg && <div style={{ font: "500 12px 'Hanken Grotesk',sans-serif", color: "#C9C9D4" }}>{msg}</div>}
        </div>
      )}
    </div>
  );
}
