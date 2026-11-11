import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SampleNoticeText } from '../src/components/SampleNotice';

describe('sample-data disclosure', () => {
  it('explicitly labels mock profiles, footage and test verification', () => {
    const html = renderToStaticMarkup(createElement(SampleNoticeText, { sample: true }));
    for (const label of ['SAMPLE / TEST PREVIEW', 'mock profiles', 'example videos', 'test values']) expect(html).toContain(label);
  });
  it('does not silently classify an unavailable status as real', () => {
    expect(renderToStaticMarkup(createElement(SampleNoticeText, { sample: null }))).toContain('DATA STATUS NOT CONFIRMED');
  });
  it('does not label a non-sample environment as mock', () => {
    expect(renderToStaticMarkup(createElement(SampleNoticeText, { sample: false }))).toBe('');
  });
});
