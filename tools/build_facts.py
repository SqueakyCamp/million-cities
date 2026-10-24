#!/usr/bin/env python3
"""Merge the city facts into static/data/facts.json for the app.

Inputs: data/raw/wiki.json (fetch_wiki.py: which Wikipedia article belongs to which city) and
tools/facts/*.json ({qid: ["fact", ...]}, written from those articles' intros).
Output: {"map": {"<db>:<id>": qid}, "f": {qid: [facts]}, "t": {qid: Wikipedia title}}.
"""
import json
from pathlib import Path

from common import RAW, OUT

wiki = json.load(open(RAW / 'wiki.json', encoding='utf-8'))
facts = {}
for p in sorted((Path(__file__).parent / 'facts').glob('*.json')):
    facts.update(json.load(open(p, encoding='utf-8')))
# some articles are reached through two Wikidata items (e.g. Tokyo metropolis vs Tokyo): share facts by title
by_title = {wiki['pages'][q]['title']: f for q, f in facts.items() if q in wiki['pages']}
for q, pg in wiki['pages'].items():
    if q not in facts and pg['title'] in by_title:
        facts[q] = by_title[pg['title']]
used = {q for q in wiki['map'].values() if q in facts}
out = dict(map={k: q for k, q in wiki['map'].items() if q in facts},
           f={q: facts[q] for q in sorted(used)},
           t={q: wiki['pages'][q]['title'] for q in sorted(used) if q in wiki['pages']})
json.dump(out, open(OUT / 'facts.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
missing = sorted({q for q in wiki['map'].values()} - set(facts))
print('facts.json:', len(out['f']), 'cities with facts,', len(out['map']), 'db entries;', len(missing), 'articles without facts')
