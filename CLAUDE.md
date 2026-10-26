# Atlas Quiz (repo: million-cities)

Map quizzes with quiz / practice / atlas modes. Home page `static/index.html` (World | Single countries) links to:
- **Million Cities** (`cities.html` + `cities.js`): the 511 cities ≥ 1M (UN WUP 2025). Built 2026-10-24; described below.
- **Quiz sets** (`set.html?s=<key>` + `set.js`, generic engine), added 2026-10-26: `physical` (≈1100 physical features),
  `languages` (158 languages as map areas, with phrases + browser speech), `at-gemeinden` (Austria, 100 largest Gemeinden).
Shared modules in `static/lib/`: `util.js` (helpers, practice picking with difficulty levels), `store.js` (progress doc,
server or localStorage), `mapbase.js` (base map style, layers popover).

Progress doc: the cities app uses the top level (quiz, cards, …); each set uses `sets[<key>] = {quiz, cards, bigger, ui}`;
`basemap`/`layers` are shared. Quiz progress per scope `<what>|<where>` (what: all | g:<group> | c:<cat> | b:<branch>).
Practice "Easier/Harder" (`LEVELS` = 5): the pool sorted easiest-first (cities by population, sets by `imp`) is cut into
bands; at level L new cards come from band L on, easier ones only while not yet known.

Quiz sets data (`tools/sets/`, run from that folder; `tools/sets/prepare_raw.sh` fetches raw inputs):
- Set file `static/data/sets/<key>.json`: {key, title, kind (features|languages|places), cats, regs, measures, bigger, items[
  {id, name, alias, cat, cat2, reg, g (pt|line|poly), ll (label point), bb, m (measures), imp (1 = best known), stats, wiki, …}]},
  plus `<key>.geojson` (shapes with property id; languages also `t`: core|also) and `<key>.facts.json` ({id: [facts]}).
- `physical_fetch.py` -> candidates from Natural Earth geography layers + lakes + rivers (`src/rivers.json` groups NE river
  segments into rivers), Wikidata (sitelinks = how well known, length/area/elevation), cached in data/raw/sets/.
  `build_physical.py` selects by sitelinks per type (MIN_SL), applies `src/phys_overrides.json` (drop/cat/name/wiki/alias, add
  point features by wiki title), computes continents/countries/measures, writes data/raw/sets/phys_factsrc.json (intros).
- `build_languages.py`: `src/languages_*.json` (spec in `src/LANG_SPEC.md`: areas as NE admin-0 ADM0_A3 / admin-1 adm1_code
  lists, speakers, phrases, facts; compiled with Claude) dissolved into core/also areas.
- `build_austria.py`: Statistik Austria population 1 Jan (Vienna's districts summed into Wien), Gemeinde polygons (WFS),
  Wikidata links; facts in `facts/at-gemeinden.json`.
- Facts for sets: `facts/*.json`, written by Claude from the Wikipedia intros per `src/FACTS_SPEC.md`.
- `build_index.py` -> data/sets/index.json (counts for the home page). Everything is in `tools/build.sh`.

## Million Cities

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
