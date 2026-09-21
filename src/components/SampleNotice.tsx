import { useEffect, useState } from 'react';

export function SampleNoticeText({ sample }: { sample: boolean | null }) {
  if (sample === false) return null;
  return <aside role="note" aria-label="Data classification" style={{ padding: '12px 20px', background: '#352607', borderBottom: '2px solid #EFB643', color: '#FFE7A0', fontSize: 14, lineHeight: 1.5 }}>
    <strong>{sample ? 'SAMPLE / TEST PREVIEW — NOT LIVE CAMPAIGN DATA' : 'DATA STATUS NOT CONFIRMED'}</strong>
    <div>{sample ? 'This preview contains mock profiles, test activity, and example videos alongside reference records. Historical footage is a demonstration, not an endorsement or a current campaign ad. Counts, scores, and “verified” labels here are test values—not verified election facts.' : 'Do not rely on these records until their source and status are confirmed.'}</div>
  </aside>;
}

export function SampleNotice() {
  const [sample, setSample] = useState<boolean | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal, cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(data => setSample(typeof data?.sample_data === 'boolean' ? data.sample_data : null))
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return <SampleNoticeText sample={sample} />;
}
