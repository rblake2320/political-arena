import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { unwrapBundle, verifyReceiptBundle } from "../receipt-verify.js";

/**
 * /verify — check a signed receipt bundle in the reader's own browser.
 * The math runs locally with WebCrypto; nothing is uploaded. The page says
 * plainly what each check proves and where the reader is still trusting
 * this site (the published key list) so they can remove that trust too.
 */

const mono = "'IBM Plex Mono', ui-monospace, monospace";
const body = "'Hanken Grotesk', system-ui, sans-serif";

type Check = { id: string; label: string; status: "pass" | "fail" | "skipped"; detail: string };
type Result = { ok: boolean; verdict: string; key_id: string | null; checks: Check[] };

const STATUS: Record<Check["status"], { text: string; color: string; bg: string }> = {
  pass: { text: "PASS", color: "#7BE0B2", bg: "rgba(52,195,132,.09)" },
  fail: { text: "FAIL", color: "#FF8A8E", bg: "rgba(229,72,77,.1)" },
  skipped: { text: "NOT CHECKED", color: "#EFB643", bg: "rgba(239,182,67,.09)" },
};

const VERDICT: Record<string, { title: string; detail: string; color: string }> = {
  verified: {
    title: "Verified",
    detail: "This bundle was signed by a key the platform publishes, and nothing in it was changed after signing.",
    color: "#7BE0B2",
  },
  consistent_untrusted_key: {
    title: "Consistent, but the signer is not confirmed",
    detail: "Nothing in the bundle was altered after signing, but the signing key could not be matched to the platform. Anyone can sign a file with their own key.",
    color: "#EFB643",
  },
  failed: {
    title: "Verification failed",
    detail: "At least one check failed. Do not rely on this file. Download a fresh bundle from the receipt page and compare.",
    color: "#FF8A8E",
  },
  invalid: {
    title: "Not a receipt bundle",
    detail: "This file is not an Arena receipt bundle or is damaged.",
    color: "#FF8A8E",
  },
};

export function VerifyReceiptPage() {
  const [params] = useSearchParams();
  const receiptId = params.get("receipt");
  const [text, setText] = useState("");
  const [bundle, setBundle] = useState<any | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [keySource, setKeySource] = useState<string | null>(null);

  const run = async (raw: string) => {
    setBusy(true);
    setError(null);
    setResult(null);
    setBundle(null);
    try {
      let parsed: any;
      try {
        parsed = unwrapBundle(JSON.parse(raw.replace(/^﻿/, "")));
      } catch {
        throw new Error("That is not valid JSON. Paste the whole bundle file or choose it with the file button.");
      }
      // The key list is the one thing fetched from this site. If it cannot be
      // loaded the check is reported as not done — never silently passed.
      let trustedKeys: string[] | undefined;
      try {
        const res = await fetch("/api/transparency/keys", { cache: "no-store", signal: AbortSignal.timeout(10000) });
        const data = res.ok ? await res.json() : null;
        const keys = data?.data?.keys;
        if (Array.isArray(keys)) {
          trustedKeys = keys.map((k: any) => k.public_key);
          setKeySource(`${keys.length} key${keys.length === 1 ? "" : "s"} published by this site right now`);
        }
      } catch {
        setKeySource(null);
      }
      const verification = (await verifyReceiptBundle(parsed, trustedKeys ? { trustedKeys } : {})) as Result;
      setBundle(parsed);
      setResult(verification);
    } catch (err: any) {
      setError(err?.message || "Verification could not run.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!receiptId) return;
    const controller = new AbortController();
    setBusy(true);
    fetch(`/api/transparency/receipts/${encodeURIComponent(receiptId)}/bundle`, { cache: "no-store", signal: controller.signal })
      .then(async res => {
        const raw = await res.text();
        if (!res.ok) throw new Error(res.status === 404 ? "That receipt was not found." : "The bundle could not be downloaded. Try again.");
        setText(raw);
        await run(raw);
      })
      .catch(err => {
        if (err?.name === "AbortError") return;
        setError(err?.message || "The bundle could not be downloaded.");
        setBusy(false);
      });
    return () => controller.abort();
  }, [receiptId]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("That file is larger than 5 MB and is not a receipt bundle.");
      return;
    }
    const raw = await file.text();
    setText(raw);
    await run(raw);
  };

  const verdict = result ? VERDICT[result.verdict] || VERDICT.failed : null;
  const challenge = bundle?.payload?.receipt?.challenge;
  const notChecked = result ? result.checks.filter(c => c.status === "skipped") : [];

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "40px 20px 80px", display: "flex", flexDirection: "column", gap: 20, fontFamily: body }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ font: `600 10px ${mono}`, letterSpacing: ".16em", color: "#8F8FF9" }}>INDEPENDENT VERIFICATION</span>
        <h1 style={{ font: "400 34px 'Instrument Serif',serif", color: "#F2F2F7", margin: 0 }}>Verify a receipt yourself</h1>
        <p style={{ font: `400 14.5px/1.65 ${body}`, color: "#C9C9D4", margin: 0 }}>
          Every public callout receipt can be downloaded as a signed evidence bundle. This page checks a bundle inside your
          browser. The file is not uploaded anywhere. You can also check it with no website at all using the offline script below.
        </p>
      </div>

      <section aria-label="Choose a bundle" style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: 14, background: "#0C0C13", padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <label htmlFor="bundle-file" style={{ font: `600 12.5px ${body}`, color: "#F2F2F7" }}>Bundle file (.json)</label>
        <input id="bundle-file" type="file" accept="application/json,.json" onChange={e => void onFile(e.target.files?.[0])} style={{ color: "#C9C9D4", font: `400 13px ${body}` }} />
        <label htmlFor="bundle-text" style={{ font: `600 12.5px ${body}`, color: "#F2F2F7" }}>Or paste the bundle</label>
        <textarea
          id="bundle-text"
          value={text}
          onChange={e => setText(e.target.value)}
          rows={7}
          spellCheck={false}
          placeholder='{"payload": {"schema": "arena.receipt-bundle/v1", ...}, "signature": {...}}'
          style={{ background: "#08080C", border: "1px solid rgba(255,255,255,.14)", borderRadius: 8, padding: 12, font: `400 12px/1.5 ${mono}`, color: "#E8E8EF", resize: "vertical", width: "100%", boxSizing: "border-box" }}
        />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" disabled={busy || !text.trim()} onClick={() => void run(text)} style={{ cursor: busy || !text.trim() ? "not-allowed" : "pointer", opacity: busy || !text.trim() ? 0.55 : 1, border: "none", borderRadius: 9, padding: "11px 18px", background: "#6E6EF7", color: "#fff", font: `600 13.5px ${body}` }}>
            {busy ? "Checking…" : "Verify bundle"}
          </button>
          {text && <button type="button" onClick={() => { setText(""); setResult(null); setBundle(null); setError(null); }} style={{ cursor: "pointer", border: "1px solid rgba(255,255,255,.18)", borderRadius: 9, padding: "10px 16px", background: "transparent", color: "#C9C9D4", font: `500 13px ${body}` }}>Clear</button>}
        </div>
      </section>

      <div aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {error && <div role="alert" style={{ border: "1px solid rgba(229,72,77,.45)", background: "rgba(229,72,77,.08)", borderRadius: 12, padding: "14px 16px", font: `500 14px/1.5 ${body}`, color: "#FF8A8E" }}>{error}</div>}

        {result && verdict && (
          <section aria-label="Result" style={{ border: `1px solid ${verdict.color}66`, borderRadius: 14, background: "#0C0C13", overflow: "hidden" }}>
            <div style={{ padding: "18px 20px", borderBottom: "1px solid rgba(255,255,255,.08)", display: "flex", flexDirection: "column", gap: 6 }}>
              <h2 style={{ font: `600 20px 'Space Grotesk',sans-serif`, color: verdict.color, margin: 0 }}>{verdict.title}</h2>
              <p style={{ font: `400 14px/1.6 ${body}`, color: "#C9C9D4", margin: 0 }}>{verdict.detail}</p>
              {result.ok && notChecked.length > 0 && (
                <p style={{ font: `500 13.5px/1.6 ${body}`, color: "#EFB643", margin: 0 }}>
                  Not covered by this result: {notChecked.map(c => c.label.toLowerCase()).join("; ")}. See the notes below.
                </p>
              )}
            </div>

            {challenge && (
              <dl style={{ margin: 0, padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,.08)", display: "grid", gridTemplateColumns: "minmax(110px, auto) 1fr", gap: "8px 16px", font: `400 13.5px/1.5 ${body}`, color: "#E8E8EF" }}>
                <dt style={{ color: "#9B9BAB" }}>Claim</dt><dd style={{ margin: 0 }}>{challenge.claim_text || challenge.challenge_text}</dd>
                <dt style={{ color: "#9B9BAB" }}>Filed by</dt><dd style={{ margin: 0 }}>{challenge.challenger?.name}</dd>
                <dt style={{ color: "#9B9BAB" }}>Addressed to</dt><dd style={{ margin: 0 }}>{challenge.target?.name}</dd>
                <dt style={{ color: "#9B9BAB" }}>Status</dt><dd style={{ margin: 0 }}>{String(challenge.status || "").toUpperCase()}</dd>
                <dt style={{ color: "#9B9BAB" }}>Snapshot taken</dt><dd style={{ margin: 0 }}>{bundle.payload.generated_at}</dd>
                <dt style={{ color: "#9B9BAB" }}>Signing key id</dt><dd style={{ margin: 0, fontFamily: mono, wordBreak: "break-all" }}>{result.key_id || "unsigned"}</dd>
              </dl>
            )}

            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {result.checks.map(c => (
                <li key={c.id} style={{ padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,.06)", display: "flex", gap: 14, alignItems: "flex-start" }}>
                  <span style={{ flex: "none", minWidth: 96, textAlign: "center", font: `700 10px ${mono}`, letterSpacing: ".08em", color: STATUS[c.status].color, background: STATUS[c.status].bg, border: `1px solid ${STATUS[c.status].color}55`, borderRadius: 6, padding: "4px 8px" }}>{STATUS[c.status].text}</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                    <span style={{ font: `600 14px ${body}`, color: "#F2F2F7" }}>{c.label}</span>
                    <span style={{ font: `400 13px/1.55 ${body}`, color: "#C9C9D4", overflowWrap: "anywhere" }}>{c.detail}</span>
                  </div>
                </li>
              ))}
            </ul>

            <div style={{ padding: "14px 20px", font: `400 13px/1.6 ${body}`, color: "#9B9BAB" }}>
              {keySource
                ? <>The signing key was compared with {keySource}. That step trusts this website. To remove that trust, compare the key id above with one you saved earlier or one quoted by a source you trust.</>
                : <>The platform's key list could not be loaded, so the signer was not confirmed.</>}
              {challenge && <> <Link to={`/challenge/${challenge.public_receipt_slug || challenge.id}`} style={{ color: "#C7C7F9" }}>Open the live receipt</Link>.</>}
            </div>
          </section>
        )}
      </div>

      <section aria-label="What this proves" style={{ border: "1px solid rgba(255,255,255,.1)", borderRadius: 14, background: "rgba(255,255,255,.02)", padding: 20, display: "flex", flexDirection: "column", gap: 10, font: `400 13.5px/1.65 ${body}`, color: "#C9C9D4" }}>
        <h2 style={{ font: `600 16px 'Space Grotesk',sans-serif`, color: "#F2F2F7", margin: 0 }}>What a verified bundle proves, and what it does not</h2>
        <p style={{ margin: 0 }}><strong style={{ color: "#F2F2F7" }}>It proves</strong> the platform issued this exact snapshot, nothing in it was edited afterward, and the audit entries link in order with none removed. When an anchor is included, it also proves those entries existed when that anchor was published.</p>
        <p style={{ margin: 0 }}><strong style={{ color: "#F2F2F7" }}>It does not prove</strong> that the claim is true. Fact scores come from the listed sources and their review status. Read the sources.</p>
        <p style={{ margin: 0 }}><strong style={{ color: "#F2F2F7" }}>No website needed:</strong> the same check runs offline with <code style={{ fontFamily: mono, color: "#E8E8EF" }}>node scripts/verify-receipt-bundle.mjs bundle.json --key &lt;public key&gt;</code> from the project's public source code.</p>
      </section>
    </div>
  );
}
