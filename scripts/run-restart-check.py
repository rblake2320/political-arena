"""Retain restart-safe receipts for the existing local Arena verification gates."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import uuid
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]


def save(path, data):
    temp = path.with_suffix('.tmp')
    with temp.open('w', encoding='utf-8') as stream:
        json.dump(data, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)


def main():
    out = ROOT / 'docs/proofs/restart-check' / uuid.uuid4().hex
    out.mkdir(parents=True, exist_ok=False)
    npm = 'npm.cmd' if os.name == 'nt' else 'npm'
    commands = [
        [npm, 'test'], [npm, 'run', 'typecheck'], [npm, 'run', 'build'],
        [npm, 'audit', '--audit-level=low'],
        ['python', 'scripts/check-local-ui.py'],
    ]
    receipt = {'started_utc': datetime.now(timezone.utc).isoformat(),
               'implementation_commit': subprocess.check_output(
                   ['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
               'status': 'running', 'checks': []}
    manifest = out / 'receipt.json'
    save(manifest, receipt)
    failed = False
    for index, command in enumerate(commands):
        log = out / f'{index}.txt'
        row = {'command': command, 'status': 'running', 'log': log.name}
        receipt['checks'].append(row)
        save(manifest, receipt)
        try:
            with log.open('wb') as stream:
                result = subprocess.run(command, cwd=ROOT, stdout=stream,
                                        stderr=subprocess.STDOUT, timeout=300)
            row.update(exit_code=result.returncode,
                       status='pass' if result.returncode == 0 else 'fail')
        except (OSError, subprocess.TimeoutExpired) as error:
            row.update(status='error', error=str(error))
        row['sha256'] = hashlib.sha256(log.read_bytes()).hexdigest() if log.exists() else None
        failed |= row['status'] != 'pass'
        save(manifest, receipt)
        print(command, row['status'], flush=True)
    receipt.update(status='fail' if failed else 'pass',
                   finished_utc=datetime.now(timezone.utc).isoformat())
    save(manifest, receipt)
    print(manifest)
    return int(failed)


if __name__ == '__main__':
    raise SystemExit(main())
