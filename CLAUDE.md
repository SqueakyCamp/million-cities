# Million Cities

Quiz, practice and atlas for the 511 cities with ≥ 1 million people (UN WUP 2025). Built 2026-10-24.

- `server.py` (stdlib), host/port from `settings.local.json` (git-ignored; default 127.0.0.1:8170), user unit `million-cities`.
  Serves `static/` (sends `*.gz` siblings when it can, ETag/304) and `GET/PUT /api/state` → `data/state.json`
  (all progress: quiz per scope, practice boxes, settings). PUT carries `rev`; on 409 the client merges.
- Frontend: `static/index.html`, `app.css`, `app.js` (ES module, MapLibre GL 6 vendored in `static/vendor/`,
  Noto Sans glyphs in `static/fonts/`). Tiles from outside: AWS terrarium DEM (terrain), Esri physical/satellite.
- Databases (selector in the panel, `S.db`): one file each in `static/data/db/`:
  `wup2025` (build_data.py, default, has outlines), `wup2018` + `wikidata` (build_alt.py). Shared helpers in tools/common.py.
  Progress keys are prefixed `<db>:` except for wup2025 (quiz scopes and practice cards).
- Data build: `tools/build.sh` (= build_data.py + build_alt.py + build_geo.py + gzip). Raw inputs in `data/raw/`;
  `tools/prepare_raw.sh` re-downloads them and makes `uc.pkl` (GHSL polygons) and `gn.pkl` (GeoNames).
  Needs `pip install --user shapely pyproj openpyxl`.
- Name fixes / extra accepted answers: `tools/overrides.py` (OVERRIDES for WUP 2025 keyed by City_Name, ALT_OVERRIDES for
  wup2018/wikidata keyed by (db, name[, ISO2]); skip/keep/pop/name/aliases/drop/note). Rebuild after editing.
- Wikidata: `tools/fetch_wikidata.py` -> data/raw/wd.json (settlement-like items >= 700k). build_alt.py filters out metro
  areas/regions/districts by type label, prefers the latest census >= 2010, sums urban districts for Chinese prefecture-level
  cities, dedupes (Tokyo Metropolis vs 23 wards, "Kota X" vs "X"). Review the list after refetching; junk goes in ALT_OVERRIDES.
- City facts ("Good to know" in the info box): `tools/fetch_wiki.py` matches every city of every db to an enwiki article
  (search hit with coordinates < 60 km away; wikidata db via its QID) -> data/raw/wiki.json (map + intro extracts).
  Facts are hand-written from those intros in `tools/facts/*.json` ({qid: [3-4 facts]}); `build_facts.py` -> static/data/facts.json
  (lazy-loaded). New cities: rerun fetch_wiki.py (incremental), add facts for the QIDs build_facts reports as missing.
- Map overlays: country/subdivision borders have a "Bold" variant (casing layer + darker, wider line). River names are placed
  on `geo/rlines.geojson`, merged + smoothed copies of the rivers (z=0 coarse below zoom 6, z=1 fine), because the drawn
  rivers zigzag too much for MapLibre line labels. Lake names are `t: 'l'` points in labels.geojson.

Data decisions:
- List + populations: WUP 2025 city file (Degree of Urbanisation), mid-2025 `Pop`. Data goes down to 800k (660 cities);
  the app's city-set selector (`S.minPop`, 1e6 default) switches between the 511 ≥ 1M and all 660. Quiz progress for
  the 800k set is stored under `<scope>@800k` and starts from the 1M finds.
  WUP keeps Shenzhen/Guangzhou, Suzhou/Wuxi etc. separate, unlike the GHSL UCDB.
- Outlines: GHSL UCDB R2024A urban centre containing the WUP centroid. If WUP splits one centre into several
  cities, the centre is divided by a power diagram whose cell sizes match WUP `AREA_km2` (approximate).
- Answer index (`answers`): primary names win over aliases; `parts` = GeoNames places ≥ 50k inside an outline
  (quiz explains "part of X"); `near` = WUP cities 300k–800k ("just under 1 million").

Hosting:
- Public copy: GitHub repo SqueakyCamp/million-cities, `.github/workflows/pages.yml` publishes `static/` to GitHub Pages
  on every push to main. Without the API the app stores progress in localStorage (per browser).
- `*.gz`, `data/raw/`, `data/state.json` and `settings.local.json` are git-ignored; the server still uses the local .gz files.
