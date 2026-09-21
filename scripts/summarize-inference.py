"""Derive comparison metrics and verify/write byte-bound proof inventories."""
import argparse
import hashlib
import json
from pathlib import Path
import statistics


def summarize(root):
    receipt = json.loads((root / 'receipt.json').read_text(encoding='utf-8'))
    if receipt['status'] != 'completed':
        raise ValueError('Cannot summarize an incomplete experiment as completed')
    groups = {g['label']: g for g in receipt['groups']}
    runs = receipt['runs']
    comparisons = {}
    for name, count, pattern_a, pattern_b in [
        ('speculation', 4, 'spec-{}-none', 'spec-{}-ngram-simple'),
        ('concurrent_requests', 2, 'batch-A-{}-none', 'batch-B-{}-none'),
    ]:
        a = [groups[pattern_a.format(i)]['wall_seconds'] for i in range(count)]
        b = [groups[pattern_b.format(i)]['wall_seconds'] for i in range(count)]
        comparisons[name] = {'baseline_seconds': a, 'treatment_seconds': b,
            'baseline_median': statistics.median(a), 'treatment_median': statistics.median(b),
            'median_paired_reduction': statistics.median((x-y)/x for x,y in zip(a,b))}
    identical = []
    for pair in range(4):
        a = {r['case']: r['response']['content'] for r in runs if r['group'] == f'spec-{pair}-none'}
        b = {r['case']: r['response']['content'] for r in runs if r['group'] == f'spec-{pair}-ngram-simple'}
        identical.extend(a[k] == b[k] for k in a)
    result = {'comparisons': comparisons, 'scored_requests': len(runs),
              'correct': sum(r['correct'] for r in runs),
              'exact_spec_output_matches': sum(identical), 'spec_output_pairs': len(identical),
              'all_owned_servers_stopped': all(g['server_stopped'] for g in groups.values()),
              'spec_graduates': receipt['summary']['spec_graduates']}
    result['case_median_seconds'] = {
        case: {mode: statistics.median(r['wall_seconds'] for r in runs
            if r['case'] == case and r['group'].startswith('spec-')
            and r['group'].endswith('-' + mode))
            for mode in ['none', 'ngram-simple']}
        for case in sorted({r['case'] for r in runs})}
    (root / 'summary.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    inventory = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in sorted(root.iterdir()) if p.is_file() and p.name != 'inventory.json'}
    (root / 'inventory.json').write_text(json.dumps(inventory, indent=2), encoding='utf-8')
    return result


def verify(root):
    inventory = json.loads((root / 'inventory.json').read_text(encoding='utf-8'))
    actual_files = {p.name for p in root.iterdir() if p.is_file() and p.name != 'inventory.json'}
    if actual_files != set(inventory):
        raise ValueError('Inventory file set mismatch')
    for name, expected in inventory.items():
        if Path(name).name != name:
            raise ValueError('Invalid inventory filename')
        if hashlib.sha256((root / name).read_bytes()).hexdigest() != expected:
            raise ValueError(f'Hash mismatch: {name}')
    return {'verified_files': len(inventory)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    print(json.dumps(verify(args.directory) if args.verify else summarize(args.directory), indent=2))
