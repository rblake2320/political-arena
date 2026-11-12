import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReciteChip } from '../src/pages/Race';

describe('Source chips are usable source links', () => {
  it('renders a navigable source rather than a decorative span', () => {
    const html = renderToStaticMarkup(createElement(ReciteChip, { r: { url: 'https://example.org/evidence', title: 'Evidence', stance: 'supports' } }));
    expect(html).toContain('href="https://example.org/evidence"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it('does not make script URLs executable', () => {
    const html = renderToStaticMarkup(createElement(ReciteChip, { r: { url: 'javascript:alert(1)', title: 'Untrusted' } }));
    expect(html).not.toContain('href=');
    expect(html).toContain('Source URL unavailable');
  });
});
