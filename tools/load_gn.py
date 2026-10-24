"""GeoNames cities15000 + alternateNamesV2 -> gn.pkl (only names of those cities). Run in data/raw."""
import io, pickle, zipfile
gn = {}
for line in open('cities15000.txt', encoding='utf-8'):
    f = line.rstrip('\n').split('\t')
    gn[int(f[0])] = dict(id=int(f[0]), name=f[1], ascii=f[2], lat=float(f[4]), lon=float(f[5]), fcode=f[7], cc=f[8], pop=int(f[14] or 0), alt=[])
with zipfile.ZipFile('alternateNamesV2.zip').open('alternateNamesV2.txt') as fh:
    for line in io.TextIOWrapper(fh, encoding='utf-8'):
        f = line.rstrip('\n').split('\t')
        g = gn.get(int(f[1]))
        if g:  # (lang, name, preferred, short, colloquial, historic)
            g['alt'].append((f[2], f[3], f[4] == '1', f[5] == '1', f[6] == '1', f[7] == '1'))
pickle.dump(gn, open('gn.pkl', 'wb'))
print(len(gn), 'GeoNames places')
