"""Small Wikipedia / Wikidata helpers shared by the set builders (stdlib only)."""
import json, sys, time, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / 'data' / 'raw'
SRC = Path(__file__).resolve().parent / 'src'
OUT = ROOT / 'static' / 'data' / 'sets'
UA = 'MillionCities/1.0 (https://github.com/SqueakyCamp/million-cities)'


def get(url, params):
    params = dict(params, format='json', formatversion=2)
    req = urllib.request.Request(url + '?' + urllib.parse.urlencode(params), headers={'User-Agent': UA})
    for i in range(6):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:
            print('retry', e, file=sys.stderr)
            time.sleep(2 + 4 * i)
    raise RuntimeError('API failed: ' + url)


def wd_entities(qids, cache):
    """Fetch Wikidata entities (claims, sitelinks, labels en/de, aliases en/de) into cache {qid: entity}."""
    todo = [q for q in dict.fromkeys(qids) if q and q not in cache]
    for i in range(0, len(todo), 50):
        r = get('https://www.wikidata.org/w/api.php', dict(action='wbgetentities', ids='|'.join(todo[i:i + 50]),
                props='claims|sitelinks|labels|aliases', languages='en|de'))
        for q, e in r.get('entities', {}).items():
            if 'missing' in e:
                cache[q] = None
                continue
            cache[q] = slim(e)
        print(f'wikidata {min(i + 50, len(todo))}/{len(todo)}', file=sys.stderr)
    return cache


UNIT_KM = {'Q828224': 1, 'Q11573': 1e-3, 'Q253276': 1.609344, 'Q3710': 0.0003048}  # km, m, mile, foot
UNIT_KM2 = {'Q712226': 1, 'Q25343': 1e-6, 'Q35852': 0.01, 'Q232291': 2.589988, 'Q81292': 1e-4}  # km², m², ha, sq mi, acre
UNIT_M = {'Q11573': 1, 'Q3710': 0.3048, 'Q828224': 1000}


def quantity(claims, prop, units):
    best = None
    for c in claims.get(prop, []):
        v = c.get('mainsnak', {}).get('datavalue', {}).get('value')
        if not isinstance(v, dict) or 'amount' not in v:
            continue
        u = v.get('unit', '').rsplit('/', 1)[-1]
        if u not in units:
            continue
        x = float(v['amount']) * units[u]
        rank = {'preferred': 2, 'normal': 1}.get(c.get('rank'), 0)
        if best is None or rank > best[0]:
            best = (rank, x)
    return best and best[1]


def slim(e):
    cl = e.get('claims', {})
    coord = None
    for c in cl.get('P625', []):
        v = c.get('mainsnak', {}).get('datavalue', {}).get('value')
        if v:
            coord = [v['longitude'], v['latitude']]
            break
    return dict(
        en=e.get('sitelinks', {}).get('enwiki', {}).get('title'),
        de=e.get('sitelinks', {}).get('dewiki', {}).get('title'),
        sl=len(e.get('sitelinks', {})),
        label_en=e.get('labels', {}).get('en', {}).get('value'),
        label_de=e.get('labels', {}).get('de', {}).get('value'),
        alias_en=[a['value'] for a in e.get('aliases', {}).get('en', [])][:8],
        alias_de=[a['value'] for a in e.get('aliases', {}).get('de', [])][:5],
        length=quantity(cl, 'P2043', UNIT_KM),
        area=quantity(cl, 'P2046', UNIT_KM2),
        elev=quantity(cl, 'P2044', UNIT_M),
        height=quantity(cl, 'P2048', UNIT_M),
        coord=coord,
        p31=[c['mainsnak'].get('datavalue', {}).get('value', {}).get('id') for c in cl.get('P31', [])][:6],
    )


def titles_to_qids(titles, lang='en'):
    """Resolve Wikipedia titles (following redirects) -> {title: (final title, qid)}."""
    out = {}
    titles = list(dict.fromkeys(titles))
    for i in range(0, len(titles), 50):
        chunk = titles[i:i + 50]
        r = get(f'https://{lang}.wikipedia.org/w/api.php', dict(action='query', titles='|'.join(chunk), redirects=1,
                prop='pageprops', ppprop='wikibase_item'))
        q = r.get('query', {})
        fwd = {}
        for x in q.get('normalized', []) + q.get('redirects', []):
            fwd[x['from']] = x['to']
        pages = {p['title']: p for p in q.get('pages', []) if not p.get('missing')}
        for t in chunk:
            f = t
            for _ in range(3):
                f = fwd.get(f, f)
            p = pages.get(f)
            out[t] = (f, p.get('pageprops', {}).get('wikibase_item')) if p else (None, None)
    return out


def intros(titles, cache, lang='en'):
    """Plain-text article intros -> cache {title: text}."""
    todo = [t for t in dict.fromkeys(titles) if t and t not in cache]
    for i in range(0, len(todo), 20):
        chunk = todo[i:i + 20]
        r = get(f'https://{lang}.wikipedia.org/w/api.php', dict(action='query', titles='|'.join(chunk), redirects=1,
                prop='extracts', exintro=1, explaintext=1, exlimit=20))
        q = r.get('query', {})
        fwd = {x['from']: x['to'] for x in q.get('normalized', []) + q.get('redirects', [])}
        ext = {p['title']: p.get('extract', '') for p in q.get('pages', [])}
        for t in chunk:
            f = fwd.get(t, t)
            f = fwd.get(f, f)
            cache[t] = ext.get(f, '')
        print(f'intros {min(i + 20, len(todo))}/{len(todo)}', file=sys.stderr)
    return cache


def load(p, default):
    try:
        return json.load(open(p, encoding='utf-8'))
    except FileNotFoundError:
        return default


def dump(obj, p, pretty=False):
    Path(p).parent.mkdir(parents=True, exist_ok=True)
    with open(p, 'w', encoding='utf-8') as f:
        if pretty:
            json.dump(obj, f, ensure_ascii=False, indent=1)
        else:
            json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
