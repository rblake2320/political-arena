import { Link, useLocation } from "react-router";

/**
 * Legal & policy pages: /terms, /privacy, /moderation-policy, /dmca.
 * Drafts written to reflect how the platform actually behaves; marked for
 * counsel review before any marketing push.
 */

const mono = "'IBM Plex Mono', ui-monospace, monospace";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ font: "600 18px 'Space Grotesk',sans-serif", color: "#F2F2F7", marginBottom: 10 }}>{title}</h2>
      <div style={{ font: "400 14px/1.7 'Hanken Grotesk',sans-serif", color: "#C9C9D4", display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>
    </section>
  );
}

const PAGES: Record<string, { title: string; body: React.ReactNode }> = {
  "/terms": {
    title: "Terms of Service",
    body: (
      <>
        <Section title="The platform">
          <p>Political Arena ("Arena") is a nonpartisan public-record platform for the 2026 U.S. elections: campaign ads with guaranteed rebuttal slots, evidence-backed fact-check callouts with public receipts, sourced citations, and voter questions. By creating an account or posting content you agree to these terms.</p>
        </Section>
        <Section title="Eligibility">
          <p>You must be at least 13 years old to create an account. Campaign features (ads, rebuttals, callouts) are limited to verified candidate campaigns and their authorized staff.</p>
        </Section>
        <Section title="Your content">
          <p>You keep ownership of what you post. You grant Arena a license to host, display, and archive it as part of the public record. Political ads, rebuttals, callout receipts, and verified citations are treated as durable public-record entries: when content is withdrawn or moderated it is marked as such rather than silently deleted, and the tamper-evident audit trail records every change.</p>
          <p>You may only upload media you have the right to use. Campaign ads must carry the sponsoring committee's "paid for by" disclaimer, and that disclaimer must remain visible in the uploaded media. If media contains AI-generated or materially AI-altered depictions of a candidate or events, you must attest to that at upload; the content will carry a visible AI-media label.</p>
        </Section>
        <Section title="Acceptable use">
          <p>Prohibited: unlawful content; credible threats or harassment; impersonating a candidate, official, campaign, or press organization; procedural voting misinformation (false dates, methods, or eligibility rules); undisclosed AI-manipulated political media; infringing uploads; attempts to manipulate fact scores, questions, or reactions through coordinated or automated activity; and interference with the platform's operation.</p>
        </Section>
        <Section title="Moderation and enforcement">
          <p>Arena may remove or restrict content and accounts that violate these terms, following the <Link to="/moderation-policy" style={{ color: "#8F8FF9" }}>Moderation &amp; Content Policy</Link>, which includes notice and an appeal path. Moderation decisions are recorded on the audit trail.</p>
        </Section>
        <Section title="Disclaimers">
          <p>Fact scores are transparent summaries of the sourced citations on file — not declarations of absolute truth. Arena provides the record; readers judge it. The service is provided "as is" without warranties, and Arena's liability is limited to the fullest extent permitted by law.</p>
        </Section>
        <Section title="Status of this document">
          <p style={{ color: "#EFB643" }}>Draft v1 (2026-08-20) — under legal review. Material changes will be announced on this page.</p>
        </Section>
      </>
    ),
  },
  "/privacy": {
    title: "Privacy Policy",
    body: (
      <>
        <Section title="What we collect">
          <p>Account data: email, username, display name, password (stored as a salted hash), and — optionally, if you provide them — party affiliation and state/district. Content you post: questions, votes, citations, correction requests, reactions, issue priorities, and campaign materials. Technical data: hashed IP addresses (salted, never stored raw) used for rate limiting and abuse prevention, and page-view analytics without third-party ad trackers.</p>
        </Section>
        <Section title="How it's used">
          <p>To operate the platform: authentication, notifications you subscribe to, moderation, abuse prevention, and aggregate nonpartisan statistics (e.g., "what matters" issue tallies). We do not sell personal data, run advertising trackers, or share data with campaigns beyond what you post publicly.</p>
        </Section>
        <Section title="Your rights">
          <p><strong>Access/export:</strong> Settings → "Export my data" downloads everything tied to your account as JSON. <strong>Correction:</strong> edit your profile in Settings. <strong>Deletion:</strong> Settings → "Delete account" anonymizes your personal data immediately; public-record contributions (questions, citations) remain, attributed to "Deleted account", because the integrity of the public record — including its hash-chained audit trail — depends on entries not vanishing. Emails: verification and password-reset messages only, plus notification emails if you opt in.</p>
        </Section>
        <Section title="Retention">
          <p>Analytics events and impression logs are archived to cold storage after 30 days. Public-record content is retained for the life of the platform. Sessions expire after 24 hours; inactive session rows are purged after 30 days.</p>
        </Section>
        <Section title="Children">
          <p>Arena is not directed at children under 13 and does not knowingly collect their data. Accounts identified as under-13 are deleted.</p>
        </Section>
        <Section title="Status of this document">
          <p style={{ color: "#EFB643" }}>Draft v1 (2026-08-20) — under legal review. Contact for privacy requests: privacy@mail.politicalarena.app.</p>
        </Section>
      </>
    ),
  },
  "/moderation-policy": {
    title: "Moderation & Content Policy",
    body: (
      <>
        <Section title="Principles">
          <p>Arena is nonpartisan by construction: the same rules, evidentiary standards, and enforcement apply to every party, campaign, and outlet. Moderation exists to protect the integrity of the record, not to referee political viewpoints.</p>
        </Section>
        <Section title="What gets reviewed">
          <p>Campaign ads and rebuttals are reviewed before publication (disclaimers present, no prohibited content). Sourced citations ("recites") are verified or rejected by moderators before they count toward fact scores. Reported content (the ⚑ Report control) is triaged by category, with threats and election-procedure misinformation prioritized.</p>
        </Section>
        <Section title="Election integrity">
          <p>Content asserting false voting procedures (dates, methods, eligibility), impersonating election officials, or presenting AI-manipulated depictions of candidates without the required label is removed and recorded.</p>
        </Section>
        <Section title="Notice and appeals">
          <p>When content is removed or rejected, the decision and reason are recorded on the audit trail. Any user may contest a decision through a <strong>correction request</strong> on the affected content — correction requests enter a moderated queue and end in a public ruling (upheld / revised / rejected) with a written note. Statement scoring uses a published rubric, and high-stakes designations require a second reviewer.</p>
        </Section>
        <Section title="Transparency">
          <p>Every moderation action — approvals, rejections, takedowns, restorations, and safety-case activity — is written to a hash-chained, append-only audit log. Receipts display their chain state publicly ("CHAIN VERIFIED").</p>
        </Section>
        <Section title="Status of this document">
          <p style={{ color: "#EFB643" }}>Draft v1 (2026-08-20) — under legal review.</p>
        </Section>
      </>
    ),
  },
  "/dmca": {
    title: "Copyright & DMCA",
    body: (
      <>
        <Section title="Reporting copyright infringement">
          <p>Arena hosts user-uploaded campaign media. If you believe content on Arena infringes your copyright, send a notice containing: (1) identification of the copyrighted work; (2) the URL of the infringing material on Arena; (3) your contact information; (4) a statement of good-faith belief that the use is unauthorized; (5) a statement, under penalty of perjury, that the notice is accurate and you are authorized to act; and (6) your physical or electronic signature.</p>
          <p>Send notices to: <strong>copyright@mail.politicalarena.app</strong>. Use the ⚑ Report control (category: copyright) for in-product flagging.</p>
        </Section>
        <Section title="Counter-notices">
          <p>If your content was removed and you believe the removal was mistaken, you may submit a counter-notice with the statutory elements of 17 U.S.C. § 512(g); content may be restored in 10–14 business days absent court action by the claimant.</p>
        </Section>
        <Section title="Repeat infringers">
          <p>Accounts that repeatedly upload infringing material are terminated.</p>
        </Section>
        <Section title="Status">
          <p style={{ color: "#EFB643" }}>Designated-agent registration with the U.S. Copyright Office DMCA directory is pending — required before public launch. Draft v1 (2026-08-20), under legal review.</p>
        </Section>
      </>
    ),
  },
};

export function LegalPage() {
  const { pathname } = useLocation();
  const page = PAGES[pathname];
  if (!page) return null;
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "44px 20px 80px" }}>
      <div style={{ font: `600 9.5px ${mono}`, letterSpacing: ".18em", color: "#5C5C6E", marginBottom: 10 }}>ARENA · POLICY</div>
      <h1 style={{ font: "400 36px 'Instrument Serif',serif", color: "#F2F2F7", marginBottom: 26 }}>{page.title}</h1>
      {page.body}
      <nav style={{ display: "flex", gap: 18, borderTop: "1px solid rgba(255,255,255,.08)", paddingTop: 18, flexWrap: "wrap" }} aria-label="Policy pages">
        {Object.entries(PAGES).map(([path, p]) => (
          <Link key={path} to={path} style={{ font: `500 11px ${mono}`, color: pathname === path ? "#F2F2F7" : "#8F8FF9", textDecoration: "none" }}>{p.title}</Link>
        ))}
      </nav>
    </div>
  );
}
