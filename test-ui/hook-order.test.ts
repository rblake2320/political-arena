/**
 * Hook-order regression sweep.
 *
 * A React hook placed after an early `return` crashes the page on the render
 * where the early return stops happening ("Rendered more hooks than during
 * the previous render"). That took down every public receipt page once: the
 * loading render ran 5 hooks, the loaded render ran 6.
 *
 * This scans every page and component: inside a top-level component, no hook
 * call may appear after the first top-level conditional return.
 */
import { describe, expect, it } from 'vitest';

const sources = {
  ...import.meta.glob('../src/pages/*.tsx', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../src/components/*.tsx', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../src/App.tsx', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>;

const COMPONENT_START = /^(?:export )?function ([A-Z]\w*)\(/;
const EARLY_RETURN = /^  if \(.*\)\s*(?:\{\s*)?return\b|^  if \(.*\) \{$/;
const HOOK_CALL = /\buse[A-Z]\w*\(/;

export function findHooksAfterEarlyReturn(source: string): string[] {
  const problems: string[] = [];
  let component: string | null = null;
  let sawEarlyReturn = false;
  let pendingIfBlock = false;

  source.split('\n').forEach((line, index) => {
    const start = line.match(COMPONENT_START);
    if (start) { component = start[1]; sawEarlyReturn = false; pendingIfBlock = false; return; }
    if (line === '}') { component = null; return; }
    if (!component) return;

    // Only statements at the component's own indentation level (2 spaces) count.
    if (/^  \S/.test(line)) {
      if (/^  if \(.*\)\s*return\b/.test(line) || /^  if \(.*\) \{\s*return\b/.test(line)) sawEarlyReturn = true;
      else if (/^  if \(.*\) \{$/.test(line)) pendingIfBlock = true;
      else if (line.startsWith('  }')) pendingIfBlock = false;
      if (sawEarlyReturn && HOOK_CALL.test(line) && !/^  (?:if|return)\b/.test(line)) {
        problems.push(`${component} line ${index + 1}: ${line.trim().slice(0, 80)}`);
      }
    } else if (pendingIfBlock && /^    return\b/.test(line)) {
      sawEarlyReturn = true;
    }
  });
  return problems;
}

describe('hook order', () => {
  it('detects a hook after an early return (the scanner itself works)', () => {
    const broken = [
      'export function Broken() {',
      '  const [data, setData] = useState(null);',
      '  if (!data) return <div />;',
      '  useEffect(() => {}, []);',
      '  return <div />;',
      '}',
    ].join('\n');
    expect(findHooksAfterEarlyReturn(broken)).toHaveLength(1);

    const blockForm = broken.replace('  if (!data) return <div />;', '  if (!data) {\n    return <div />;\n  }');
    expect(findHooksAfterEarlyReturn(blockForm)).toHaveLength(1);

    const fine = [
      'export function Fine() {',
      '  const [data, setData] = useState(null);',
      '  useEffect(() => {}, []);',
      '  if (!data) return <div />;',
      '  return <div />;',
      '}',
    ].join('\n');
    expect(findHooksAfterEarlyReturn(fine)).toEqual([]);
  });

  it('no page or component calls a hook after an early return', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20);
    const problems = Object.entries(sources).flatMap(([file, source]) =>
      findHooksAfterEarlyReturn(source).map(problem => `${file.replace('../', '')} → ${problem}`));
    expect(problems).toEqual([]);
  });
});
