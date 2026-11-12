import { useEffect, useState } from "react";
import { useAuth } from "../stores/auth";
import * as api from "../api";

const mono = "'IBM Plex Mono', ui-monospace, monospace";

type Queue = "candidates" | "press" | "recites" | "ads" | "rebuttals" | "corrections" | "reports" | "statements" | "safety" | "identity";

const QUEUES: { key: Queue; label: string; blurb: string }[] = [
  { key: "candidates", label: "Candidate claims", blurb: "Campaign profile registrations awaiting verification." },
  { key: "press", label: "Press credentials", blurb: "Press applications awaiting approval." },
  { key: "recites", label: "Recites", blurb: "Source citations awaiting verification." },
  { key: "ads", label: "Ads", blurb: "Submitted campaign ads awaiting review before they can run." },
  { key: "rebuttals", label: "Rebuttals", blurb: "Submitted rebuttals awaiting review — the response window is live, review promptly." },
  { key: "corrections", label: "Corrections", blurb: "Correction and appeal requests awaiting a ruling. A ruling needs a resolution note." },
  { key: "reports", label: "Reports", blurb: "User-flagged content — defamation, threats, impersonation, undisclosed AI media, copyright, spam. Highest priority first." },
  { key: "statements", label: "Statements", blurb: "Public statements awaiting truth/answer scoring against the published rubric. High-stakes designations need a second reviewer." },
  { key: "identity", label: "Voting-record identity", blurb: "Which official record belongs to a candidate. One person proposes with evidence; a different person confirms. Attaching the wrong person's votes is the worst error here — when unsure, reject." },
  { key: "safety", label: "Safety", blurb: "Threat and abuse case files. Open a case on any subject and follow it with an audited event trail." },
];

function Btn({ onClick, disabled, tone = "neutral", children }: { onClick: () => void; disabled?: boolean; tone?: "ok" | "no" | "neutral"; children: React.ReactNode }) {
  const c = tone === "ok" ? "#34C384" : tone === "no" ? "#E5636A" : "#9B9BAB";
  return (
    <button onClick={onClick} disabled={disabled} style={{ cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1, font: `600 11px 'Hanken Grotesk',sans-serif`, color: c, background: `${c}12`, border: `1px solid ${c}44`, padding: "7px 13px", borderRadius: 8 }}>{children}</button>
  );
}

function Meta({ children }: { children: React.ReactNode }) {
  return <div style={{ font: `500 10px ${mono}`, color: "#5C5C6E", letterSpacing: ".06em" }}>{children}</div>;
}

const inputStyle: React.CSSProperties = { background: "#08080C", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8, padding: "8px 10px", font: `400 12px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" };

const SEVERITY_COLORS: Record<string, string> = { critical: "#E5636A", high: "#EFB643", medium: "#8F8FF9", low: "#9B9BAB" };

const EMPTY_IDENTITY = { candidate_id: "", identifier_value: "", official_name: "", match_method: "official_directory", match_confidence: "90", evidence_url: "", evidence_note: "" };

function IdentityProposeForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_IDENTITY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const idOk = /^[A-Za-z]\d{6}$/.test(form.identifier_value.trim());
  const confidence = Number(form.match_confidence);
  const ready = form.candidate_id.trim() && idOk && form.official_name.trim().length >= 2 && /^https?:\/\//i.test(form.evidence_url.trim()) && Number.isInteger(confidence) && confidence >= 0 && confidence <= 100;
  const submit = async () => {
    setSaving(true);
    setErr("");
    try {
      await api.proposeIdentityLink({
        candidate_id: form.candidate_id.trim(),
        identifier_value: form.identifier_value.trim().toUpperCase(),
        official_name: form.official_name.trim(),
        match_method: form.match_method as any,
        match_confidence: confidence,
        evidence_url: form.evidence_url.trim(),
        evidence_note: form.evidence_note.trim() || undefined,
      });
      setForm(EMPTY_IDENTITY);
      setOpen(false);
      onCreated();
    } catch (e: any) { setErr(e?.response?.data?.error || e?.message || "Could not propose the match"); }
    finally { setSaving(false); }
  };
  if (!open) {
    return <div style={{ marginBottom: 14 }}><Btn tone="neutral" onClick={() => setOpen(true)}>+ Propose an identity match</Btn></div>;
  }
  return (
    <div style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, background: "#0C0C13", padding: 16, marginBottom: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input aria-label="Candidate ID" value={form.candidate_id} onChange={e => setForm({ ...form, candidate_id: e.target.value })} placeholder="Candidate ID (from the profile address)" style={{ ...inputStyle, flex: 1, minWidth: 200 }} />
        <input aria-label="Bioguide ID" value={form.identifier_value} onChange={e => setForm({ ...form, identifier_value: e.target.value })} placeholder="Bioguide ID, e.g. A000001" style={{ ...inputStyle, width: 190 }} />
      </div>
      <input aria-label="Official name" value={form.official_name} onChange={e => setForm({ ...form, official_name: e.target.value })} placeholder="Name exactly as the official directory lists it" style={inputStyle} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select aria-label="Match method" value={form.match_method} onChange={e => setForm({ ...form, match_method: e.target.value })} style={inputStyle}>
          <option value="official_directory">Official directory</option>
          <option value="fec_crosswalk">FEC crosswalk</option>
          <option value="manual">Manual research</option>
        </select>
        <input aria-label="Confidence 0 to 100" value={form.match_confidence} onChange={e => setForm({ ...form, match_confidence: e.target.value })} inputMode="numeric" placeholder="Confidence 0–100" style={{ ...inputStyle, width: 150 }} />
        <input aria-label="Evidence link" value={form.evidence_url} onChange={e => setForm({ ...form, evidence_url: e.target.value })} placeholder="Evidence link the second reviewer can open (https://…)" style={{ ...inputStyle, flex: 1, minWidth: 220 }} />
      </div>
      <textarea aria-label="Evidence note" value={form.evidence_note} onChange={e => setForm({ ...form, evidence_note: e.target.value })} placeholder="What matches: state, district, years served (optional)" rows={2} style={inputStyle} />
      {form.identifier_value && !idOk && <div style={{ font: `500 12px 'Hanken Grotesk',sans-serif`, color: "#EFB643" }}>A Bioguide ID is one letter followed by six digits.</div>}
      {err && <div role="alert" style={{ font: `500 12px 'Hanken Grotesk',sans-serif`, color: "#E5636A" }}>{err}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <Btn tone="ok" disabled={saving || !ready} onClick={submit}>Propose match</Btn>
        <Btn onClick={() => setOpen(false)}>Cancel</Btn>
      </div>
    </div>
  );
}

function SafetyCaseForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ subject_type: "user", subject_id: "", title: "", category: "threat", severity: "medium", summary: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const submit = async () => {
    setSaving(true);
    setErr("");
    try {
      await api.createSafetyCase(form);
      setForm({ subject_type: "user", subject_id: "", title: "", category: "threat", severity: "medium", summary: "" });
      setOpen(false);
      onCreated();
    } catch (e: any) { setErr(e?.response?.data?.error || e?.message || "Failed to open case"); }
    finally { setSaving(false); }
  };
  if (!open) {
    return <div style={{ marginBottom: 14 }}><Btn tone="neutral" onClick={() => setOpen(true)}>+ Open a case</Btn></div>;
  }
  return (
    <div style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, background: "#0C0C13", padding: 16, marginBottom: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select value={form.subject_type} onChange={e => setForm({ ...form, subject_type: e.target.value })} style={inputStyle}>
          {["user", "candidate", "challenge", "ad", "rebuttal", "question", "recite", "statement", "other"].map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input value={form.subject_id} onChange={e => setForm({ ...form, subject_id: e.target.value })} placeholder="Subject ID" style={{ ...inputStyle, flex: 1, minWidth: 160 }} />
        <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} style={inputStyle}>
          {["threat", "harassment", "impersonation", "coordinated_abuse", "election_integrity", "legal", "other"].map(c => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
        </select>
        <select value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value })} style={inputStyle}>
          {["low", "medium", "high", "critical"].map(sv => <option key={sv} value={sv}>{sv}</option>)}
        </select>
      </div>
      <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Case title (what needs following?)" style={inputStyle} />
      <textarea value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} placeholder="Summary / context (optional)" rows={2} style={inputStyle} />
      {err && <div style={{ font: `500 12px 'Hanken Grotesk',sans-serif`, color: "#E5636A" }}>{err}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <Btn tone="ok" disabled={saving || form.title.trim().length < 3 || !form.subject_id.trim()} onClick={submit}>Open case</Btn>
        <Btn onClick={() => setOpen(false)}>Cancel</Btn>
      </div>
    </div>
  );
}

function SafetyCaseCard({ item, noteValue, onNote, onChanged, busy, setBusy }: { item: any; noteValue: string; onNote: (v: string) => void; onChanged: () => void; busy: boolean; setBusy: (v: string | null) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [events, setEvents] = useState<any[] | null>(null);
  const sevColor = SEVERITY_COLORS[item.severity] || "#9B9BAB";
  const act = async (payload: any) => {
    setBusy(item.id);
    try { await api.addSafetyCaseEvent(item.id, payload); onNote(""); onChanged(); }
    catch { /* reload handles */ }
    finally { setBusy(null); }
  };
  const loadEvents = () => {
    if (events) { setExpanded(!expanded); return; }
    api.getSafetyCase(item.id).then(d => { setEvents(d.events || []); setExpanded(true); }).catch(() => setEvents([]));
  };
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span style={{ font: `600 15px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }}>{item.title}</span>
        <span style={{ font: `700 9px ${mono}`, letterSpacing: ".12em", color: sevColor, background: `${sevColor}12`, border: `1px solid ${sevColor}44`, padding: "4px 9px", borderRadius: 99 }}>
          {String(item.severity).toUpperCase()} · {String(item.status).toUpperCase()}
        </span>
      </div>
      <Meta>{[`${item.subject_type}: ${item.subject_id}`, (item.category || "").replace(/_/g, " "), item.created_by_name && `BY ${item.created_by_name}`, item.updated_at && `UPDATED ${String(item.updated_at).slice(0, 10)}`, `${item.event_count || 0} EVENTS`].filter(Boolean).join(" · ").toUpperCase()}</Meta>
      {item.summary && <div style={{ font: `400 13px/1.55 'Hanken Grotesk',sans-serif`, color: "#C9C9D4" }}>{item.summary}</div>}
      <input value={noteValue} onChange={e => onNote(e.target.value)} placeholder="Add a case note (kept on the audited trail)" style={inputStyle} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Btn disabled={busy || !noteValue.trim()} onClick={() => act({ note: noteValue.trim() })}>Add note</Btn>
        {item.status !== "watching" && <Btn disabled={busy} onClick={() => act({ status: "watching" })}>Watch</Btn>}
        {item.status !== "escalated" && <Btn tone="no" disabled={busy} onClick={() => act({ status: "escalated" })}>Escalate</Btn>}
        {item.status !== "resolved" && <Btn tone="ok" disabled={busy} onClick={() => act({ status: "resolved" })}>Resolve</Btn>}
        <Btn onClick={loadEvents}>{expanded ? "Hide trail" : "View trail"}</Btn>
      </div>
      {expanded && events && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,.08)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          {events.map((ev: any) => (
            <div key={ev.id} style={{ font: `400 11px ${mono}`, color: "#9B9BAB" }}>
              {String(ev.created_at).slice(0, 16)} · {ev.actor_name} · {ev.event_type}{ev.after_value ? ` → ${ev.after_value}` : ""}{ev.note ? ` — ${ev.note}` : ""}{ev.evidence_url ? " (evidence)" : ""}
            </div>
          ))}
          {events.length === 0 && <span style={{ font: `400 11px ${mono}`, color: "#5C5C6E" }}>No events.</span>}
        </div>
      )}
    </>
  );
}

export function ModerationPage() {
  const { user } = useAuth();
  const canModerate = Boolean(user && ["moderator", "admin", "super_admin"].includes(user.role));
  const [queue, setQueue] = useState<Queue>("candidates");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    const fetcher =
      queue === "candidates" ? api.getPendingCandidates()
        : queue === "press" ? api.getPendingPress()
          : queue === "recites" ? api.getPendingRecites({ status: "pending" })
            : queue === "corrections" ? api.getPendingCorrections("open")
              : queue === "reports" ? api.getReports()
                : queue === "statements" ? api.getPendingStatements()
                  : queue === "safety" ? api.getSafetyCases()
                    : queue === "identity" ? Promise.all([api.getIdentityLinks("proposed"), api.getIdentityLinks("confirmed")]).then(([p, c]) => ({ links: [...p.links, ...c.links] }))
                    : api.getAdModerationQueue();
    fetcher
      .then((d: any) => {
        if (queue === "ads") return setItems(d?.ads || []);
        if (queue === "rebuttals") return setItems(d?.rebuttals || []);
        if (queue === "identity") return setItems(d?.links || []);
        setItems(d?.candidates || d?.applications || d?.credentials || d?.press || d?.recites || d?.corrections || d?.cases || d?.reports || d?.statements || (Array.isArray(d) ? d : []));
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (canModerate) load(); }, [queue, canModerate]);

  const act = async (id: string, fn: () => Promise<any>) => {
    setBusy(id);
    setError(null);
    try { await fn(); setItems(prev => prev.filter(x => x.id !== id)); }
    catch (e: any) { setError(e?.message || "Action failed"); load(); }
    finally { setBusy(null); }
  };

  const noteFor = (id: string) => (notes[id] || "").trim();

  if (!canModerate) {
    return <div style={{ maxWidth: 520, margin: "0 auto", padding: "96px 16px", textAlign: "center" }}>
      <div style={{ font: `400 26px 'Instrument Serif',serif`, color: "#F2F2F7", marginBottom: 8 }}>Moderation</div>
      <div style={{ font: `400 13px ${mono}`, color: "#9B9BAB" }}>Only moderators and admins can clear applications.</div>
    </div>;
  }

  return (
    <div style={{ background: "#08080C", color: "#F2F2F7", minHeight: "60vh" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "36px 24px 56px" }}>
        <div style={{ font: `400 34px 'Instrument Serif',serif`, color: "#F2F2F7" }}>Applications to clear</div>
        <div style={{ font: `400 13px/1.6 'Hanken Grotesk',sans-serif`, color: "#9B9BAB", marginTop: 6, maxWidth: 640 }}>
          Every inbound application lands here so nothing goes stale. Clear each one — approve or return it — and the decision is recorded on the audit trail.
        </div>

        <div style={{ display: "flex", gap: 4, marginTop: 22, borderBottom: "1px solid rgba(255,255,255,.08)", overflowX: "auto" }}>
          {QUEUES.map(q => (
            <button key={q.key} onClick={() => setQueue(q.key)} style={{ flexShrink: 0, cursor: "pointer", background: "none", border: "none", font: `${queue === q.key ? 600 : 500} 13px 'Hanken Grotesk',sans-serif`, color: queue === q.key ? "#F2F2F7" : "#9B9BAB", padding: "12px 14px 11px", borderBottom: queue === q.key ? "2px solid #6E6EF7" : "2px solid transparent", whiteSpace: "nowrap" }}>{q.label}</button>
          ))}
        </div>
        <div style={{ font: `500 10px ${mono}`, letterSpacing: ".1em", color: "#5C5C6E", margin: "14px 0" }}>{QUEUES.find(q => q.key === queue)?.blurb.toUpperCase()}</div>

        {error && (
          <div style={{ border: "1px solid rgba(229,99,106,.4)", borderRadius: 10, background: "rgba(229,99,106,.08)", padding: "10px 14px", marginBottom: 12, font: `500 12px 'Hanken Grotesk',sans-serif`, color: "#E5636A" }}>{error}</div>
        )}

        {queue === "safety" && <SafetyCaseForm onCreated={load} />}
        {queue === "identity" && <IdentityProposeForm onCreated={load} />}

        {loading ? (
          <div style={{ padding: "60px 0", textAlign: "center" }}><span className="arena-pulse" style={{ display: "inline-block", width: 20, height: 20, border: "2px solid rgba(110,110,247,.3)", borderTopColor: "#6E6EF7", borderRadius: "50%" }} /></div>
        ) : items.length === 0 ? (
          <div style={{ border: "1px solid rgba(255,255,255,.09)", borderRadius: 12, background: "#0C0C13", padding: 28, textAlign: "center" }}>
            <div style={{ font: `500 14px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }}>Queue clear</div>
            <div style={{ font: `400 12px ${mono}`, color: "#5C5C6E", marginTop: 4 }}>Nothing pending — no {queue} waiting on review.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {items.map(it => (
              <div key={it.id} style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 12, background: "#0C0C13", padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
                {queue === "candidates" && <>
                  <div><span style={{ font: `600 15px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }}>{it.name}</span> <span style={{ font: `500 10px ${mono}`, color: it.party?.toLowerCase().startsWith("d") ? "#4D8AF0" : it.party?.toLowerCase().startsWith("r") ? "#E5636A" : "#9B9BAB", letterSpacing: ".1em" }}>{(it.party || "").toUpperCase()}</span></div>
                  <Meta>{[it.race_name || it.race_id, it.race_state, it.created_at && `FILED ${String(it.created_at).slice(0, 10)}`].filter(Boolean).join(" · ").toUpperCase()}</Meta>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn tone="ok" disabled={busy === it.id} onClick={() => act(it.id, () => api.verifyCandidate(it.id, "verify"))}>Verify</Btn>
                    <Btn tone="no" disabled={busy === it.id} onClick={() => act(it.id, () => api.verifyCandidate(it.id, "reject"))}>Reject</Btn>
                  </div>
                </>}
                {queue === "press" && <>
                  <div><span style={{ font: `600 15px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }}>{it.outlet_name || it.outlet}</span> <span style={{ font: `500 10px ${mono}`, color: "#9B9BAB", letterSpacing: ".1em" }}>{(it.outlet_type || "").toUpperCase()}</span></div>
                  {it.proof_url && <a href={it.proof_url} target="_blank" rel="noreferrer" style={{ font: `500 11px ${mono}`, color: "#8F8FF9" }}>{it.proof_url} ↗</a>}
                  <Meta>{it.created_at && `APPLIED ${String(it.created_at).slice(0, 10)}`}</Meta>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn tone="ok" disabled={busy === it.id} onClick={() => act(it.id, () => api.reviewPress(it.id, "approved"))}>Approve</Btn>
                    <Btn tone="no" disabled={busy === it.id} onClick={() => act(it.id, () => api.reviewPress(it.id, "rejected"))}>Reject</Btn>
                  </div>
                </>}
                {queue === "recites" && <>
                  <a href={it.url} target="_blank" rel="noreferrer" style={{ font: `600 14px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7", textDecoration: "none" }}>{it.title} ↗</a>
                  <Meta>{[it.source_type, it.stance, it.publisher].filter(Boolean).join(" · ").toUpperCase()}</Meta>
                  {it.quote && <div style={{ font: `italic 400 13px 'Hanken Grotesk',sans-serif`, color: "#C9C9D4", borderLeft: "2px solid rgba(255,255,255,.14)", paddingLeft: 12 }}>“{it.quote}”</div>}
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn tone="ok" disabled={busy === it.id} onClick={() => act(it.id, () => api.reviewRecite(it.id, "verified"))}>Verify</Btn>
                    <Btn tone="no" disabled={busy === it.id} onClick={() => act(it.id, () => api.reviewRecite(it.id, "rejected"))}>Reject</Btn>
                  </div>
                </>}
                {queue === "ads" && <>
                  <div><span style={{ font: `600 15px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }}>{it.title}</span> <span style={{ font: `500 10px ${mono}`, color: "#9B9BAB", letterSpacing: ".1em" }}>{(it.media_type || "").toUpperCase()}</span></div>
                  <Meta>{[it.candidate_name, it.candidate_party, it.race_name, it.created_at && `SUBMITTED ${String(it.created_at).slice(0, 10)}`].filter(Boolean).join(" · ").toUpperCase()}</Meta>
                  {it.ad_content_text && <div style={{ font: `400 13px/1.55 'Hanken Grotesk',sans-serif`, color: "#C9C9D4" }}>{it.ad_content_text}</div>}
                  {it.media_url && <a href={it.media_url} target="_blank" rel="noreferrer" style={{ font: `500 11px ${mono}`, color: "#8F8FF9" }}>Open media ↗</a>}
                  {it.disclaimer_text && <Meta>DISCLAIMER: {it.disclaimer_text}</Meta>}
                  <input value={notes[it.id] || ""} onChange={e => setNotes(prev => ({ ...prev, [it.id]: e.target.value }))} placeholder="Rejection reason (required to reject)" style={{ background: "#08080C", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8, padding: "8px 10px", font: `400 12px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }} />
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn tone="ok" disabled={busy === it.id} onClick={() => act(it.id, () => api.reviewAd(it.id, "approve"))}>Approve</Btn>
                    <Btn tone="no" disabled={busy === it.id || !noteFor(it.id)} onClick={() => act(it.id, () => api.reviewAd(it.id, "reject", noteFor(it.id)))}>Reject</Btn>
                  </div>
                </>}
                {queue === "rebuttals" && <>
                  <div><span style={{ font: `600 15px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }}>Rebuttal to “{it.parent_ad_title}”</span></div>
                  <Meta>{[it.candidate_name, it.candidate_party, it.race_name, it.created_at && `SUBMITTED ${String(it.created_at).slice(0, 10)}`].filter(Boolean).join(" · ").toUpperCase()}</Meta>
                  {it.response_text && <div style={{ font: `400 13px/1.55 'Hanken Grotesk',sans-serif`, color: "#C9C9D4", borderLeft: "2px solid rgba(255,255,255,.14)", paddingLeft: 12 }}>{it.response_text}</div>}
                  {it.media_url && <a href={it.media_url} target="_blank" rel="noreferrer" style={{ font: `500 11px ${mono}`, color: "#8F8FF9" }}>Open media ↗</a>}
                  {it.disclaimer_text && <Meta>DISCLAIMER: {it.disclaimer_text}</Meta>}
                  <input value={notes[it.id] || ""} onChange={e => setNotes(prev => ({ ...prev, [it.id]: e.target.value }))} placeholder="Rejection reason (required to reject)" style={{ background: "#08080C", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8, padding: "8px 10px", font: `400 12px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }} />
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn tone="ok" disabled={busy === it.id} onClick={() => act(it.id, () => api.reviewRebuttal(it.id, "approve"))}>Approve &amp; run</Btn>
                    <Btn tone="no" disabled={busy === it.id || !noteFor(it.id)} onClick={() => act(it.id, () => api.reviewRebuttal(it.id, "reject", noteFor(it.id)))}>Reject</Btn>
                  </div>
                </>}
                {queue === "reports" && <>
                  <div><span style={{ font: `600 15px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }}>{(it.notes || "").split("]")[0].replace("[", "").replace(/_/g, " ") || "report"}</span> <span style={{ font: `500 10px ${mono}`, color: "#9B9BAB", letterSpacing: ".1em" }}>{String(it.content_type || "").toUpperCase()} · {it.content_id}</span></div>
                  <Meta>{[it.reporter_name && `REPORTED BY ${it.reporter_name}`, it.created_at && `FILED ${String(it.created_at).slice(0, 10)}`, it.priority > 1 && "HIGH PRIORITY"].filter(Boolean).join(" · ").toUpperCase()}</Meta>
                  {it.notes && <div style={{ font: `400 13px/1.55 'Hanken Grotesk',sans-serif`, color: "#C9C9D4", borderLeft: "2px solid rgba(255,255,255,.14)", paddingLeft: 12 }}>{it.notes}</div>}
                  <input value={notes[it.id] || ""} onChange={e => setNotes(prev => ({ ...prev, [it.id]: e.target.value }))} placeholder="Resolution note (recorded on the audit trail)" style={{ background: "#08080C", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8, padding: "8px 10px", font: `400 12px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }} />
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn tone="no" disabled={busy === it.id} onClick={() => act(it.id, () => api.resolveReport(it.id, "upheld", noteFor(it.id) || undefined))}>Uphold report</Btn>
                    <Btn disabled={busy === it.id} onClick={() => act(it.id, () => api.resolveReport(it.id, "overturned", noteFor(it.id) || undefined))}>Dismiss</Btn>
                  </div>
                </>}
                {queue === "statements" && <>
                  <div><span style={{ font: `600 14px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }}>{(it.statement_text || "").slice(0, 180)}</span></div>
                  <Meta>{[it.candidate_name, it.topic, it.source_type, it.created_at && `LOGGED ${String(it.created_at).slice(0, 10)}`].filter(Boolean).join(" · ").toUpperCase()}</Meta>
                  {it.source_url && <a href={it.source_url} target="_blank" rel="noreferrer" style={{ font: `500 11px ${mono}`, color: "#8F8FF9" }}>Source ↗</a>}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <select value={notes[`${it.id}-truth`] || "unreviewed"} onChange={e => setNotes(prev => ({ ...prev, [`${it.id}-truth`]: e.target.value }))} style={{ background: "#08080C", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8, padding: "7px 9px", font: `400 12px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }} aria-label="Truth status">
                      {["unreviewed", "supported", "disputed", "false", "mixed", "context_needed"].map(v => <option key={v} value={v}>truth: {v}</option>)}
                    </select>
                    <select value={notes[`${it.id}-answer`] || "answered"} onChange={e => setNotes(prev => ({ ...prev, [`${it.id}-answer`]: e.target.value }))} style={{ background: "#08080C", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8, padding: "7px 9px", font: `400 12px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }} aria-label="Answer status">
                      {["answered", "partial", "dodged", "not_applicable", "unclear"].map(v => <option key={v} value={v}>answer: {v}</option>)}
                    </select>
                    <Btn tone="ok" disabled={busy === it.id} onClick={() => act(it.id, () => api.reviewStatement(it.id, { truth_status: (notes[`${it.id}-truth`] || "unreviewed") as any, answer_status: (notes[`${it.id}-answer`] || "answered") as any }))}>Record review</Btn>
                  </div>
                </>}
                {queue === "safety" && <SafetyCaseCard item={it} noteValue={notes[it.id] || ""} onNote={v => setNotes(prev => ({ ...prev, [it.id]: v }))} onChanged={load} busy={busy === it.id} setBusy={setBusy} />}
                {queue === "identity" && <>
                  <div><span style={{ font: `600 15px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }}>{it.candidate_name} → {it.identifier_value}{it.official_name ? ` (${it.official_name})` : ""}</span></div>
                  <Meta>{[it.status, it.race_name, `${it.race_state} ${it.race_office}`, `METHOD ${it.match_method}`, `CONFIDENCE ${it.match_confidence}`, `${it.loaded_votes} VOTES LOADED`, it.proposed_by_name && `PROPOSED BY ${it.proposed_by_name}`].filter(Boolean).join(" · ").toUpperCase()}</Meta>
                  {it.evidence_note && <div style={{ font: `400 13px/1.55 'Hanken Grotesk',sans-serif`, color: "#C9C9D4", borderLeft: "2px solid rgba(255,255,255,.14)", paddingLeft: 12 }}>{it.evidence_note}</div>}
                  <a href={it.evidence_url} target="_blank" rel="noopener noreferrer" style={{ font: `500 11px ${mono}`, color: "#8F8FF9", overflowWrap: "anywhere" }}>{it.evidence_url} ↗</a>
                  {it.status === "proposed" && !it.can_review && <div style={{ font: `500 12px 'Hanken Grotesk',sans-serif`, color: "#EFB643" }}>You proposed this link. A different reviewer must decide it.</div>}
                  {(it.status === "confirmed" || it.can_review) && <>
                    <input value={notes[it.id] || ""} onChange={e => setNotes(prev => ({ ...prev, [it.id]: e.target.value }))} aria-label="Decision note" placeholder={it.status === "confirmed" ? "Why revoke? (required, min 5 chars)" : "What you checked (required, min 5 chars)"} style={inputStyle} />
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {it.status === "proposed" && <>
                        <Btn tone="ok" disabled={busy === it.id || noteFor(it.id).length < 5} onClick={() => act(it.id, () => api.reviewIdentityLink(it.id, "confirm", noteFor(it.id)))}>Confirm match</Btn>
                        <Btn tone="no" disabled={busy === it.id || noteFor(it.id).length < 5} onClick={() => act(it.id, () => api.reviewIdentityLink(it.id, "reject", noteFor(it.id)))}>Reject</Btn>
                      </>}
                      {it.status === "confirmed" && <Btn tone="no" disabled={busy === it.id || noteFor(it.id).length < 5} onClick={() => act(it.id, () => api.revokeIdentityLink(it.id, noteFor(it.id)))}>Revoke (hides the record now)</Btn>}
                    </div>
                  </>}
                </>}
                {queue === "corrections" && <>
                  <div><span style={{ font: `600 15px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }}>{(it.reason || "correction").replace(/_/g, " ")} — {it.content_type}</span></div>
                  <Meta>{[it.candidate_name, it.race_name, it.requester_name && `FROM ${it.requester_name}`, it.created_at && `FILED ${String(it.created_at).slice(0, 10)}`].filter(Boolean).join(" · ").toUpperCase()}</Meta>
                  {it.requested_change && <div style={{ font: `400 13px/1.55 'Hanken Grotesk',sans-serif`, color: "#C9C9D4", borderLeft: "2px solid rgba(255,255,255,.14)", paddingLeft: 12 }}>{it.requested_change}</div>}
                  {it.evidence_url && <a href={it.evidence_url} target="_blank" rel="noreferrer" style={{ font: `500 11px ${mono}`, color: "#8F8FF9" }}>{it.evidence_url} ↗</a>}
                  <input value={notes[it.id] || ""} onChange={e => setNotes(prev => ({ ...prev, [it.id]: e.target.value }))} placeholder="Resolution note (required, min 5 chars, becomes part of the record)" style={{ background: "#08080C", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8, padding: "8px 10px", font: `400 12px 'Hanken Grotesk',sans-serif`, color: "#F2F2F7" }} />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Btn tone="ok" disabled={busy === it.id || noteFor(it.id).length < 5} onClick={() => act(it.id, () => api.reviewCorrection(it.id, "upheld", noteFor(it.id), noteFor(it.id)))}>Uphold</Btn>
                    <Btn disabled={busy === it.id || noteFor(it.id).length < 5} onClick={() => act(it.id, () => api.reviewCorrection(it.id, "revised", noteFor(it.id), noteFor(it.id)))}>Revised</Btn>
                    <Btn tone="no" disabled={busy === it.id || noteFor(it.id).length < 5} onClick={() => act(it.id, () => api.reviewCorrection(it.id, "rejected", noteFor(it.id)))}>Reject</Btn>
                  </div>
                </>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
