#!/usr/bin/env python3
"""Find file references of an RPG Maker MV/MZ game that only work on Windows.

Usage: python3 -I rpgm_casecheck.py /path/to/game/www   (MV)
       python3 -I rpgm_casecheck.py /path/to/game       (MZ, no www folder)

Windows finds files ignoring case, Linux doesn't. This script collects every
string of the game's data (data/*.json), plugin list (js/plugins.js) and
index.html, and reports the ones that name an existing asset, script or plugin
only when ignoring case. Each line shows the reference and the actual file.

It can't see file names that scripts build at runtime, so a clean result
doesn't guarantee that no case problem is left: run the game and watch its
console for 404 errors as well.
"""
import json
import os
import re
import sys

root = sys.argv[1] if len(sys.argv) > 1 else '.'

# All files, by lowercase relative path
files = {}
for d, _, names in os.walk(root):
    for n in names:
        rel = os.path.relpath(os.path.join(d, n), root).replace(os.sep, '/')
        files.setdefault(rel.lower(), []).append(rel)

asset_dirs = sorted({os.path.dirname(p) for p in files
                     if p.startswith(('img/', 'audio/', 'movies/', 'fonts/'))})
exts = ['', '.png', '.rpgmvp', '.png_', '.ogg', '.rpgmvo', '.ogg_', '.m4a', '.rpgmvm',
        '.m4a_', '.webm', '.mp4', '.ttf', '.otf', '.woff', '.js']


def strings(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from strings(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from strings(v)


refs = set()
data_dir = os.path.join(root, 'data')
for n in sorted(os.listdir(data_dir)) if os.path.isdir(data_dir) else []:
    if n.endswith('.json'):
        with open(os.path.join(data_dir, n), encoding='utf-8-sig') as f:
            try:
                refs.update(strings(json.load(f)))
            except ValueError as e:
                print('could not parse', n, e)

plugins_js = os.path.join(root, 'js', 'plugins.js')
if os.path.exists(plugins_js):
    text = open(plugins_js, encoding='utf-8-sig').read()
    m = re.search(r'\[.*\]', text, re.S)
    if m:
        for p in json.loads(m.group(0)):
            refs.add('js/plugins/' + p['name'] + '.js')
            refs.update(strings(p.get('parameters', {})))

index = os.path.join(root, 'index.html')
if os.path.exists(index):
    refs.update(re.findall(r'(?:src|href)="([^"]+)"', open(index, encoding='utf-8').read()))

problems = set()
for s in refs:
    s = s.strip()
    if not s or len(s) > 200 or '\n' in s:
        continue
    candidates = [s] + [d + '/' + s for d in asset_dirs]
    for c in candidates:
        for e in exts:
            p = (c + e).lower()
            if p in files and (c + e) not in files[p]:
                problems.add((c + e, ', '.join(files[p])))

for ref, actual in sorted(problems):
    print('%s  ->  %s' % (ref, actual))
print('%d case mismatches in %d strings' % (len(problems), len(refs)), file=sys.stderr)
