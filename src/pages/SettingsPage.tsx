import { useState } from "react";
import { useNavigate } from "react-router";
import * as api from "../api";
import { useAuth } from "../stores/auth";

const mono = "'IBM Plex Mono', ui-monospace, monospace";
const US_STATES = ['', 'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'];

const card: React.CSSProperties = { border: "1px solid rgba(255,255,255,.1)", borderRadius: 14, background: "#0C0C13", padding: 22, display: "flex", flexDirection: "column", gap: 12 };
const inputStyle: React.CSSProperties = { background: "#08080C", border: "1px solid rgba(255,255,255,.12)", borderRadius: 8, padding: "9px 11px", font: "400 13px 'Hanken Grotesk',sans-serif", color: "#F2F2F7" };
const btn = (color: string): React.CSSProperties => ({ cursor: "pointer", font: "700 12px 'Hanken Grotesk',sans-serif", color: "#08080C", background: color, border: "none", padding: "10px 16px", borderRadius: 8, alignSelf: "flex-start" });
const h2: React.CSSProperties = { font: "600 16px 'Space Grotesk',sans-serif", color: "#F2F2F7", margin: 0 };
const label: React.CSSProperties = { font: `600 9px ${mono}`, letterSpacing: ".14em", color: "#5C5C6E" };

export function SettingsPage() {
  const { user, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState({
    display_name: user?.display_name || "",
    party_affiliation: (user as any)?.party_affiliation || "",
    jurisdiction_state: (user as any)?.jurisdiction_state || "",
  });
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [delPw, setDelPw] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try { setMsg({ kind: "ok", text: await fn() }); }
    catch (err: any) { setMsg({ kind: "err", text: err?.response?.data?.error || err?.message || "Something went wrong" }); }
    finally { setBusy(false); }
  };

  const saveProfile = () => run(async () => {
    await api.updateMe({
      display_name: profile.display_name.trim() || undefined,
      party_affiliation: profile.party_affiliation || undefined,
      jurisdiction_state: profile.jurisdiction_state || undefined,
    });
    await refresh();
    return "Profile saved.";
  });

  const changePassword = () => run(async () => {
    if (pw.next !== pw.confirm) throw new Error("New passwords do not match");
    const res = await api.changePassword(pw.current, pw.next);
    setPw({ current: "", next: "", confirm: "" });
    return res.message || "Password changed.";
  });

  const exportData = () => run(async () => {
    const data = await api.exportMyData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `arena-data-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    return "Export downloaded.";
  });

  const deleteAccount = () => run(async () => {
    await api.deleteAccount(delPw);
    await logout();
    navigate("/");
    return "Account deleted.";
  });

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "40px 20px 80px", display: "flex", flexDirection: "column", gap: 18 }}>
      <h1 style={{ font: "400 32px 'Instrument Serif',serif", color: "#F2F2F7", margin: 0 }}>Account settings</h1>
      {msg && (
        <div role="status" style={{ border: `1px solid ${msg.kind === "ok" ? "rgba(52,195,132,.4)" : "rgba(229,99,106,.4)"}`, background: msg.kind === "ok" ? "rgba(52,195,132,.07)" : "rgba(229,99,106,.07)", borderRadius: 10, padding: "10px 14px", font: "500 13px 'Hanken Grotesk',sans-serif", color: msg.kind === "ok" ? "#7BE0B2" : "#E5636A" }}>{msg.text}</div>
      )}

      <div style={card}>
        <h2 style={h2}>Profile</h2>
        <span style={label}>DISPLAY NAME</span>
        <input value={profile.display_name} onChange={e => setProfile({ ...profile, display_name: e.target.value })} style={inputStyle} aria-label="Display name" />
        <span style={label}>PARTY AFFILIATION (OPTIONAL)</span>
        <select value={profile.party_affiliation} onChange={e => setProfile({ ...profile, party_affiliation: e.target.value })} style={inputStyle} aria-label="Party affiliation">
          <option value="">Prefer not to say</option>
          <option value="Democrat">Democrat</option>
          <option value="Republican">Republican</option>
          <option value="Independent">Independent</option>
          <option value="Other">Other</option>
        </select>
        <span style={label}>STATE (OPTIONAL)</span>
        <select value={profile.jurisdiction_state} onChange={e => setProfile({ ...profile, jurisdiction_state: e.target.value })} style={inputStyle} aria-label="State">
          {US_STATES.map(s => <option key={s} value={s}>{s || "Prefer not to say"}</option>)}
        </select>
        <button disabled={busy} onClick={saveProfile} style={btn("#8F8FF9")}>Save profile</button>
      </div>

      <div style={card}>
        <h2 style={h2}>Change password</h2>
        <input type="password" placeholder="Current password" value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} style={inputStyle} aria-label="Current password" />
        <input type="password" placeholder="New password (8+ chars, upper+lower+number+symbol)" value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} style={inputStyle} aria-label="New password" />
        <input type="password" placeholder="Confirm new password" value={pw.confirm} onChange={e => setPw({ ...pw, confirm: e.target.value })} style={inputStyle} aria-label="Confirm new password" />
        <span style={{ font: "400 11.5px 'Hanken Grotesk',sans-serif", color: "#9B9BAB" }}>Changing your password signs out every other session.</span>
        <button disabled={busy || !pw.current || !pw.next} onClick={changePassword} style={btn("#8F8FF9")}>Change password</button>
      </div>

      <div style={card}>
        <h2 style={h2}>Your data</h2>
        <span style={{ font: "400 12.5px/1.6 'Hanken Grotesk',sans-serif", color: "#9B9BAB" }}>Download everything tied to your account — profile, questions, votes, citations, correction requests, reactions, priorities, subscriptions — as JSON.</span>
        <button disabled={busy} onClick={exportData} style={btn("#34C384")}>Export my data</button>
      </div>

      <div style={{ ...card, border: "1px solid rgba(229,99,106,.35)" }}>
        <h2 style={{ ...h2, color: "#E5636A" }}>Delete account</h2>
        <span style={{ font: "400 12.5px/1.6 'Hanken Grotesk',sans-serif", color: "#9B9BAB" }}>
          Your personal data (email, name, affiliations) is anonymized immediately and you are signed out everywhere. Public-record contributions remain, attributed to "Deleted account" — the tamper-evident record does not lose entries. This cannot be undone.
        </span>
        <input type="password" placeholder="Confirm with your password" value={delPw} onChange={e => setDelPw(e.target.value)} style={inputStyle} aria-label="Password to confirm deletion" />
        <button disabled={busy || !delPw} onClick={deleteAccount} style={btn("#E5636A")}>Delete my account permanently</button>
      </div>
    </div>
  );
}
