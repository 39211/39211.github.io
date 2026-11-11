"""Repair one verified public article before the generated-owned snapshot.

Only the reviewed Pages and publisher inputs (and their repaired forms) are
accepted. New source content must be reviewed; never overwrite unknown bytes.
No network, private sources, whole-site generation or overlay ownership change.
"""
import argparse
import hashlib
import json
from pathlib import Path

TARGET = 'posts/2026-11-11-slot-02.html'
MANIFEST = Path(__file__).with_name('shoe_article_repair.json')

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def repaired_bytes(raw):
    data = json.loads(MANIFEST.read_text(encoding='utf-8'))
    if data['path'] != TARGET:
        raise ValueError('Unexpected repair target')
    sha = digest(raw)
    if sha in {v['after_sha256'] for v in data['variants']}:
        return raw
    variant = next((v for v in data['variants'] if sha == v['before_sha256']), None)
    if variant is None:
        raise ValueError(f'Unknown source for {TARGET}: {sha}; review required')
    text = raw.decode('utf-8')
    for change in data['changes']:
        if not change['before'] or text.count(change['before']) != 1:
            raise ValueError('Repair fragment is missing or ambiguous')
        text = text.replace(change['before'], change['after'], 1)
    result = text.encode('utf-8')
    if digest(result) != variant['after_sha256']:
        raise ValueError('Repaired article hash mismatch')
    return result

def repair(site_root):
    root = Path(site_root).resolve()
    target = root / TARGET
    if target.is_symlink() or target.parent.is_symlink() or target.resolve().parent != root / 'posts':
        raise ValueError('Unsafe repair target')
    before = target.read_bytes()  # Missing inputs fail closed too.
    after = repaired_bytes(before)
    if after != before:
        target.write_bytes(after)
    return digest(after)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site-root', type=Path, required=True)
    args = parser.parse_args()
    print(f'{TARGET}: {repair(args.site_root)}')
