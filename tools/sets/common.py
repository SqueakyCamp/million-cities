"""Shared helpers for the quiz-set builders."""
import collections, re, unicodedata


def norm(s):
    """Answer key, same as norm() in static/lib/util.js."""
    s = unicodedata.normalize('NFKD', str(s).lower())
    s = ''.join(c for c in s if not unicodedata.combining(c))
    for a, b in (('ß', 'ss'), ('ø', 'o'), ('đ', 'd'), ('ł', 'l'), ('ı', 'i'), ('æ', 'ae'), ('œ', 'oe')):
        s = s.replace(a, b)
    return re.sub(r'[^a-z0-9]+', '', s)


def aliases_unique(items):
    """Clean item['alias']: drop empties, duplicates of the name, and aliases that would also match another item
    (an alias may never steal another item's name; aliases shared by several items are dropped)."""
    names = collections.Counter(norm(it['name']) for it in items)
    use = collections.Counter()
    for it in items:
        ks = {norm(a) for a in it.get('alias', []) if a and norm(a)} - {norm(it['name'])}
        use.update(ks)
    for it in items:
        seen, out = {norm(it['name'])}, []
        for a in it.get('alias', []):
            k = a and norm(a)
            if not k or k in seen or names[k] or use[k] > 1:
                continue
            seen.add(k)
            out.append(a.strip())
        it['alias'] = out


def round_geom(g, nd=3):
    def r(c):
        if isinstance(c[0], (int, float)):
            return [round(c[0], nd), round(c[1], nd)]
        return [r(x) for x in c]
    out = {'type': g['type'], 'coordinates': r(g['coordinates'])}
    return out
