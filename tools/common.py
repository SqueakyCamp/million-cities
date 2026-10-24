"""Helpers shared by the database builders (build_data.py = WUP 2025, build_alt.py = WUP 2018 + Wikidata)."""
import json, pickle, re, unicodedata
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'data' / 'raw'
OUT = ROOT / 'static' / 'data'
DB_OUT = OUT / 'db'
DB_OUT.mkdir(parents=True, exist_ok=True)

THRESHOLD = 1_000_000  # the main list
EXTENDED = 800_000     # optional extra set the app can switch on


def norm(s):
    """Key used for matching typed answers: lowercase, no accents, letters/digits only (same as app.js)."""
    s = unicodedata.normalize('NFKD', s.lower())
    s = ''.join(c for c in s if not unicodedata.combining(c))
    s = s.replace('ß', 'ss').replace('ø', 'o').replace('đ', 'd').replace('ł', 'l').replace('ı', 'i').replace('æ', 'ae').replace('œ', 'oe')
    return re.sub(r'[^a-z0-9]+', '', s)


LATIN = re.compile(r"^[\sA-Za-zÀ-ɏḀ-ỿ'’‘ʻ`.\-()]+$")


def is_latin(s):
    return bool(LATIN.match(s))


def split_wup_name(raw):
    """'Tōkyō (Tokyo)' -> ('Tokyo', 'Tōkyō'); anything else -> (raw, None)."""
    m = re.match(r'^(.*?)\s*\((.*)\)\s*$', raw)
    if m:
        return m.group(2).strip(), m.group(1).strip()
    return raw.strip(), None


# ---------------------------------------------------------------- countries / regions
def load_locations():
    """UN location list: LocID -> row, ISO2 -> row."""
    import openpyxl
    wb = openpyxl.load_workbook(RAW / 'locations.xlsx', read_only=True)
    loc, by_iso2, hdr = {}, {}, None
    for r in wb['DB'].iter_rows(values_only=True):
        if hdr is None:
            hdr = r
            continue
        d = dict(zip(hdr, r))
        loc[d['LocID']] = d
        if d.get('ISO2_Code') and d.get('LocTypeName') in ('Country/Area', 'Area (dependency)'):
            by_iso2[d['ISO2_Code']] = d
    return loc, by_iso2


countries = {}
for line in open(RAW / 'countryInfo.txt', encoding='utf-8'):
    if line.startswith('#'):
        continue
    f = line.rstrip('\n').split('\t')
    countries[f[0]] = dict(name=f[4], langs=[l.split('-')[0] for l in f[15].split(',') if l])
COUNTRY_NAME_FIX = {'TW': 'Taiwan', 'PS': 'Palestine', 'CD': 'DR Congo', 'CG': 'Congo', 'CI': "Côte d'Ivoire",
                    'KR': 'South Korea', 'KP': 'North Korea', 'US': 'United States', 'GB': 'United Kingdom',
                    'MO': 'Macao', 'HK': 'Hong Kong', 'TR': 'Türkiye', 'CZ': 'Czechia'}


def country_name(cc, fallback=None):
    return COUNTRY_NAME_FIX.get(cc) or countries.get(cc, {}).get('name') or fallback or cc


def continent(d):
    """UN "major area" (GeoRegName), with the Americas split into Latin and Northern America."""
    g = d.get('GeoRegName')
    sub = d.get('SubRegName')
    if g == 'Latin America and the Caribbean' or sub in ('South America', 'Central America', 'Caribbean'):
        return 'Latin America'
    if g == 'Northern America':
        return 'Northern America'
    return g


# ---------------------------------------------------------------- GeoNames
SKIP_LANG = {'link', 'iata', 'icao', 'faac', 'post', 'wkdt', 'abbr', 'unlc', 'fr_1793', 'tcid'}
_gn = None


def geonames():
    """(gn dict, list without sub-places, STRtree over that list)"""
    global _gn
    if _gn is None:
        from shapely import STRtree, Point
        gn = pickle.load(open(RAW / 'gn.pkl', 'rb'))
        lst = [g for g in gn.values() if g['fcode'] not in ('PPLX', 'PPLH', 'PPLQ', 'PPLW')]
        _gn = (gn, lst, STRtree([Point(g['lon'], g['lat']) for g in lst]))
    return _gn


def gn_names(g, cc):
    """Latin-script names of a GeoNames place in English, German and the country's languages:
    (current names, historic/colloquial names)."""
    langs = {'en', 'de'} | set(countries.get(cc, {}).get('langs', []))
    out = {g['name'], g['ascii']}
    hist = set()
    for lang, name, pref, short, coll, histo in g['alt']:
        if lang in SKIP_LANG or lang not in langs or not is_latin(name) or len(norm(name)) < 3:
            continue
        (hist if (histo or coll) else out).add(name)
    return out, hist - out


def gn_match(names, lat, lon, cc, radius=0.3):
    """The GeoNames place near (lat, lon) whose names overlap `names`, biggest first."""
    from shapely import Point
    gn, lst, tree = geonames()
    keys = {norm(n) for n in names if n}
    cands = [lst[int(j)] for j in tree.query(Point(lon, lat).buffer(radius))]
    cands = [g for g in cands if not cc or g['cc'] == cc]
    for g in sorted(cands, key=lambda g: -g['pop']):
        if keys & {norm(x) for x in gn_names(g, cc)[0]}:
            return g
    return None


# ---------------------------------------------------------------- output
def finish(cities, union_keys=()):
    """Rank cities, add country ranks, build the answer index. Returns answers."""
    cities.sort(key=lambda c: -c['pop'])
    for i, c in enumerate(cities, 1):
        c['rank'] = i
    byc = defaultdict(list)
    for c in cities:
        byc[c['iso2']].append(c)
    for lst in byc.values():
        for i, c in enumerate(lst, 1):
            c['crank'] = i
            c['cn'] = len(lst)
    # primary names win over aliases, so a key that is one city's real name never also
    # counts another city that merely lists it
    primary, alias = defaultdict(set), defaultdict(set)
    for c in cities:
        primary[norm(c['name'])].add(c['id'])
        for a in c['aliases'] + c.get('historic', []):
            alias[norm(a)].add(c['id'])
    answers = {}
    for k in (set(primary) | set(alias)) - {''}:
        answers[k] = sorted(primary[k]) if k in primary else sorted(alias[k])
    for k in map(norm, union_keys):
        if primary[k] | alias[k]:
            answers[k] = sorted(primary[k] | alias[k])
    return answers


def write_db(key, meta, cities, answers, near=None, parts=None):
    doc = dict(meta, key=key, threshold=THRESHOLD, extended=EXTENDED, cities=cities,
               answers=answers, near=near or {}, parts=parts or {})
    path = DB_OUT / f'{key}.json'
    json.dump(doc, open(path, 'w'), ensure_ascii=False, separators=(',', ':'))
    amb = {k: [next(c['name'] + '/' + c['iso2'] for c in cities if c['id'] == i) for i in v]
           for k, v in answers.items() if len(v) > 1}
    print(f'{key}: {len(cities)} cities ({sum(c["pop"] >= THRESHOLD for c in cities)} >= 1M), '
          f'{path.stat().st_size // 1024} KB; ambiguous: {amb}')
