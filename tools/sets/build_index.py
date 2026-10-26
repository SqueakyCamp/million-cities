#!/usr/bin/env python3
"""static/data/sets/index.json: item counts of every quiz set, for the home page."""
import json
from wiki import OUT, dump

out = {}
for p in sorted(OUT.glob('*.json')):
    if p.name.endswith('.facts.json') or p.name == 'index.json':
        continue
    d = json.load(open(p, encoding='utf-8'))
    out[d['key']] = dict(n=len(d['items']), title=d['title'], sub=d['sub'])
dump(out, OUT / 'index.json', pretty=True)
print(out)
