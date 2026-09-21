"""Preserve local Wrangler D1/R2 state without copying live SQLite WAL files.

Usage: python scripts/snapshot-local-state.py SOURCE_V3 NEW_DESTINATION_V3
Keep snapshots private: they contain local accounts and uploaded media.
"""
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import sys


def snapshot(source: Path, destination: Path):
    source = source.resolve(strict=True)
    destination = destination.resolve()
    if destination.exists() or source == destination or source in destination.parents:
        raise ValueError('Destination must be new and outside the source tree')
    if not (source / 'd1').is_dir():
        raise ValueError('Source must be a Wrangler v3 state directory containing d1')
    destination.mkdir(parents=True)
    receipts = []
    for area in ('d1', 'r2'):
        for original in sorted((source / area).rglob('*')):
            if not original.is_file() or original.name.endswith(('-wal', '-shm')):
                continue
            relative = original.relative_to(source)
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            if original.suffix == '.sqlite':
                with sqlite3.connect(original.as_uri() + '?mode=ro', uri=True) as read:
                    with sqlite3.connect(target) as write:
                        read.backup(write)
                        if write.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                            raise RuntimeError(f'Snapshot integrity failure: {relative}')
            else:
                shutil.copy2(original, target)
            with target.open('rb') as content:
                digest = hashlib.file_digest(content, 'sha256').hexdigest()
            receipts.append({'path': relative.as_posix(), 'bytes': target.stat().st_size, 'sha256': digest})
    (destination / 'snapshot-receipt.json').write_text(json.dumps(receipts, indent=2), encoding='utf-8')
    print(json.dumps({'files': len(receipts), 'destination': str(destination)}))


if __name__ == '__main__':
    snapshot(Path(sys.argv[1]), Path(sys.argv[2]))
