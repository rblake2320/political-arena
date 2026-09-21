"""Bounded real inference comparison; no hosted calls or application writes.

Requires an explicitly supplied llama-server executable and local GGUF model.
The four synthetic cases and graduation criterion are frozen before execution.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import socket
import statistics
import subprocess
import time
import urllib.request

def save(path, value):
    temp = path.with_suffix('.tmp')
    with temp.open('w', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)


QUOTE = ('This is sample training footage, not a live campaign record. '
         'The visible result is a saved document. The recording does not show '
         'which input caused that result. Keep the original source timestamp '
         'and identify the missing action evidence. A displayed confirmation '
         'does not establish the identity of the operator. Do not replace '
         'unresolved evidence with a confident instruction. A reviewer must '
         'inspect the source before publication. Retain the before image, '
         'the result image, and the uncertainty note together.')
CASES = [
    {'id': 'sample-label', 'task': 'Return only SAMPLE or LIVE. '
     'The dataset contains mock profiles, test counts and example videos.', 'expected': 'SAMPLE'},
    {'id': 'missing-action', 'task': 'Return only UNKNOWN or CLICK_SAVE. '
     'A screenshot shows Saved. No mouse, keyboard, control activation or earlier '
     'action footage is available. What initiating action is established?', 'expected': 'UNKNOWN'},
    {'id': 'source-copy', 'task': 'Copy the following source exactly. Output only '
     'the source, without quotes or explanation:\n' + QUOTE, 'expected': QUOTE},
    {'id': 'receipt-extract', 'task': 'Return only a JSON object with exactly '
     'these keys: sample, action, result. Evidence: sample=true; action is '
     'unknown; result is saved. Do not infer an action.',
     'expected': {'sample': True, 'action': 'unknown', 'result': 'saved'}},
]


def correct(case, output):
    if isinstance(case['expected'], dict):
        try:
            return json.loads(output) == case['expected']
        except ValueError:
            return False
    return output.strip() == case['expected']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--server', required=True, type=Path)
    parser.add_argument('--model', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    for path in (args.server, args.model):
        if not path.is_file():
            raise FileNotFoundError(path)
    out = args.output
    out.mkdir(parents=True, exist_ok=False)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    url = f'http://127.0.0.1:{port}'
    config = {'cases': CASES, 'pairs': 4, 'order': ['AB', 'BA', 'AB', 'BA'],
              'criterion': 'all task outputs correct; no accuracy loss; median paired wall reduction >= 10%',
              'runtime': str(args.server), 'model_path': str(args.model),
              'server_sha256': hashlib.sha256(args.server.read_bytes()).hexdigest(),
              'model_sha256': hashlib.file_digest(args.model.open('rb'), 'sha256').hexdigest(),
              'sampling': {'temperature': 0, 'seed': 42, 'n_predict': 256, 'cache_prompt': False},
              'scope': 'synthetic text evidence handling; Vulkan GPU backend; not TensorRT, Jev, or visual perception'}
    save(out / 'frozen-config.json', config)
    receipt = {'status': 'running', 'started': datetime.now(timezone.utc).isoformat(),
               'runs': [], 'groups': [], 'errors': []}
    save(out / 'receipt.json', receipt)

    def request(case):
        payload = dict(config['sampling'], stream=False,
            prompt='<|im_start|>system\nFollow the requested output format exactly.<|im_end|>\n'
                   '<|im_start|>user\n' + case['task'] + '<|im_end|>\n<|im_start|>assistant\n',
            stop=['<|im_end|>'])
        started = time.perf_counter()
        req = urllib.request.Request(url + '/completion',
            data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=90) as response:
            value = json.load(response)
        text = value.get('content', '')
        return {'case': case['id'], 'wall_seconds': time.perf_counter() - started,
                'correct': correct(case, text), 'response': value}

    def execute(mode, phase, pair, concurrent=False):
        label = f'{phase}-{pair}-{mode}'
        command = [str(args.server), '-m', str(args.model), '--host', '127.0.0.1',
                   '--port', str(port), '-c', '4096', '-np', '2', '-ngl', 'all',
                   '--cache-ram', '0', '--spec-type', mode, '--spec-draft-n-max', '16']
        group = {'label': label, 'command': command, 'status': 'running'}
        receipt['groups'].append(group)
        save(out / 'receipt.json', receipt)
        with (out / (label + '.txt')).open('wb') as log:
            process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            try:
                deadline = time.monotonic() + 90
                while True:
                    if process.poll() is not None:
                        raise RuntimeError(f'{label}: server exited {process.returncode}')
                    try:
                        with urllib.request.urlopen(url + '/health', timeout=2) as response:
                            if response.status == 200:
                                break
                    except OSError:
                        if time.monotonic() > deadline:
                            raise TimeoutError('server health timeout')
                        time.sleep(.25)
                warmup = request(CASES[0])
                group['warmup'] = warmup
                started = time.perf_counter()
                if concurrent:
                    with ThreadPoolExecutor(max_workers=2) as pool:
                        results = list(pool.map(request, CASES))
                else:
                    results = []
                    for case in CASES:
                        result = request(case)
                        results.append(result)
                        receipt['runs'].append(dict(result, group=label))
                        save(out / 'receipt.json', receipt)
                if concurrent:
                    receipt['runs'].extend(dict(result, group=label) for result in results)
                group.update(status='complete', wall_seconds=time.perf_counter() - started,
                             correct=sum(r['correct'] for r in results), total=len(results))
            finally:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=10)
                group['server_stopped'] = process.poll() is not None
                save(out / 'receipt.json', receipt)
        print(label, group.get('correct'), group.get('wall_seconds'), flush=True)

    try:
        for pair, order in enumerate(config['order']):
            for arm in order:
                execute('none' if arm == 'A' else 'ngram-simple', 'spec', pair)
        for pair, order in enumerate(['AB', 'BA']):
            for arm in order:
                execute('none', 'batch-' + arm, pair, concurrent=arm == 'B')
        deltas = []
        for pair in range(4):
            groups = {g['label']: g for g in receipt['groups']}
            a = groups[f'spec-{pair}-none']['wall_seconds']
            b = groups[f'spec-{pair}-ngram-simple']['wall_seconds']
            deltas.append((a-b)/a)
        spec_runs = [r for r in receipt['runs'] if r['group'].startswith('spec-')]
        receipt['summary'] = {'spec_paired_reductions': deltas,
            'spec_median_reduction': statistics.median(deltas),
            'all_tasks_correct': all(r['correct'] for r in receipt['runs']),
            'spec_graduates': all(r['correct'] for r in spec_runs) and statistics.median(deltas) >= .1}
        receipt['status'] = 'completed'
    except Exception as error:
        receipt['status'] = 'failed'
        receipt['errors'].append(repr(error))
        raise
    finally:
        receipt['finished'] = datetime.now(timezone.utc).isoformat()
        save(out / 'receipt.json', receipt)
    print(json.dumps(receipt['summary'], indent=2))


if __name__ == '__main__':
    main()
