"""Convert the GHSL UCDB geopackage (Mollweide) into uc.pkl: WGS84 polygons + names. Run in data/raw."""
import sqlite3, struct, pickle
from shapely import wkb
from shapely.ops import transform
from pyproj import Transformer
c=sqlite3.connect('GHS_UCDB_GLOBE_R2024A.gpkg')
t='GHS_UCDB_THEME_GENERAL_CHARACTERISTICS_GLOBE_R2024A'
B='﻿'
tr=Transformer.from_crs('ESRI:54009','EPSG:4326',always_xy=True)
def gp(b):
    flags=b[3]; env=(flags>>1)&7; n={0:0,1:32,2:48,3:48,4:64}[env]
    return wkb.loads(bytes(b[8+n:]))
out=[]
for r in c.execute(f'select geom,"{B}ID_UC_G0","{B}GC_UCN_MAI_2025","{B}GC_UCN_LIS_2025","{B}GC_CNT_GAD_2025","{B}GC_POP_TOT_2025","{B}GC_UCA_KM2_2025","{B}GC_UCM_CAP" from "{t}"'):
    g=transform(tr.transform, gp(r[0]))
    s=lambda x: x.replace(B,'') if isinstance(x,str) else x
    out.append(dict(geom=g,id=r[1],name=s(r[2]),names=s(r[3]),cnt=s(r[4]),pop=r[5],area=r[6],cap=s(r[7])))
pickle.dump(out,open('uc.pkl','wb'))
print(len(out))
