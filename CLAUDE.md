# Million Cities

Quiz, practice and atlas for the 511 cities with ≥ 1 million people (UN WUP 2025). Built 2026-10-24.

- `server.py` (stdlib), host/port from `settings.local.json` (git-ignored; default 127.0.0.1:8170), user unit `million-cities`.
  Serves `static/` (sends `*.gz` siblings when it can, ETag/304) and `GET/PUT /api/state` → `data/state.json`
  (all progress: quiz per scope, practice boxes, settings). PUT carries `rev`; on 409 the client merges.
- Frontend: `static/index.html`, `app.css`, `app.js` (ES module, MapLibre GL 6 vendored in `static/vendor/`,
  Noto Sans glyphs in `static/fonts/`). Tiles from outside: AWS terrarium DEM (terrain), Esri physical/satellite.
- Data build: `tools/build.sh` (= build_data.py + build_geo.py + gzip). Raw inputs in `data/raw/`;
  `tools/prepare_raw.sh` re-downloads them and makes `uc.pkl` (GHSL polygons) and `gn.pkl` (GeoNames).
  Needs `pip install --user shapely pyproj openpyxl`.
- Name fixes / extra accepted answers: `tools/overrides.py` (keyed by WUP City_Name / display name). Rebuild after editing.

Data decisions:
- List + populations: WUP 2025 city file (Degree of Urbanisation), mid-2025 `Pop`, threshold 1,000 thousand.
  WUP keeps Shenzhen/Guangzhou, Suzhou/Wuxi etc. separate, unlike the GHSL UCDB.
- Outlines: GHSL UCDB R2024A urban centre containing the WUP centroid. If WUP splits one centre into several
  cities, the centre is divided by a power diagram whose cell sizes match WUP `AREA_km2` (approximate).
- Answer index (`answers`): primary names win over aliases; `parts` = GeoNames places ≥ 50k inside an outline
  (quiz explains "part of X"); `near` = WUP cities 300k–1M ("just under 1 million").

Hosting:
- Public copy: GitHub repo SqueakyCamp/million-cities, `.github/workflows/pages.yml` publishes `static/` to GitHub Pages
  on every push to main. Without the API the app stores progress in localStorage (per browser).
- `*.gz`, `data/raw/`, `data/state.json` and `settings.local.json` are git-ignored; the server still uses the local .gz files.
