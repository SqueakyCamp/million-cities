#!/usr/bin/env python3
"""Apply the reviewers' corrections (src/lang_fixes_*.json, see src/LANG_VERIFY_SPEC.md) to src/languages_*.json
and print what changed. Run once; the fixes files stay as a record of the review."""
import json
from wiki import SRC

codes = {l.split(' | ')[0] for l in open(SRC.parent / 'ref' / 'countries.txt', encoding='utf-8') if not l.startswith('#')}
fixes = {}
for p in sorted(SRC.glob('lang_fixes_*.json')):
    fixes.update(json.load(open(p, encoding='utf-8')))
# second look at the review (2026-10-26): keep the national-level rule and well-known forms
fixes.get('pap', {}).pop('official', None)          # Papiamento: official on Bonaire only, not in the Netherlands
fixes.get('bho', {}).pop('official', None)          # "Fiji Hindi" is a separate variety
for k in ('sr', 'hr'):                              # BiH: Bosnian, Croatian and Serbian are all in official use
    if 'official' in fixes.get(k, {}) and 'BIH' not in fixes[k]['official']:
        fixes[k]['official'].append('BIH')
(fixes.get('gd', {}).get('phrases') or {}).pop('bye', None)  # "Mar sin leat" is the standard goodbye; Tìoraidh is informal
unsure = {k: v['unsure'] for k, v in fixes.items() if v.get('unsure')}
n = {'l1': 0, 'total': 0, 'official': 0, 'phrases': 0}
for p in sorted(SRC.glob('languages_*.json')):
    langs = json.load(open(p, encoding='utf-8'))
    for L in langs:
        f = fixes.get(L['id'])
        if not f:
            continue
        for k in ('l1', 'total'):
            if isinstance(f.get(k), (int, float)) and f[k] != L.get(k):
                print(f"{L['name']}: {k} {L.get(k)} -> {f[k]}")
                L[k] = f[k]; n[k] += 1
        if isinstance(f.get('official'), list):
            bad = [c for c in f['official'] if c not in codes]
            if bad:
                print(f"{L['name']}: unknown codes {bad}, official not changed")
            elif sorted(f['official']) != sorted(L.get('official', [])):
                print(f"{L['name']}: official +{sorted(set(f['official']) - set(L.get('official', [])))} -{sorted(set(L.get('official', [])) - set(f['official']))}")
                L['official'] = f['official']; n['official'] += 1
        for k, ph in (f.get('phrases') or {}).items():
            if k in ('hello', 'thanks', 'bye') and isinstance(ph, dict) and ph.get('text') and ph != L['phrases'].get(k):
                print(f"{L['name']}: {k} {L['phrases'].get(k, {}).get('text')} / {L['phrases'].get(k, {}).get('say')} -> {ph['text']} / {ph.get('say')}")
                L['phrases'][k] = {'text': ph['text'], 'rom': ph.get('rom', ''), 'say': ph.get('say', L['phrases'].get(k, {}).get('say', ''))}
                n['phrases'] += 1
        if L.get('total') is not None and L['total'] < L['l1']:
            L['total'] = L['l1']
    json.dump(langs, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(n)
print('unsure:', json.dumps(unsure, ensure_ascii=False, indent=1))
