# Shared world tracker

Private personal network extension of [God’s Eye View](https://github.com/bilawalsidhu/gods-eye-view), MIT. Core operation is deterministic and requires no model calls.

Open `/network.html` for the console and `/tar1090/` for the air-traffic viewer. An operator supplies `TAR1090_ROOT`, pointing at the `html` directory of the pinned [wiedehopf/tar1090](https://github.com/wiedehopf/tar1090) checkout (GPL-3.0; remains a separate viewer with its upstream license). Tested viewer revision: `5d59b1ba2c5e30eb23f1161940367b7767f10ad5`.

API base: `/api/world-tracker/v1`. `GET /status` reports each source. `GET /tracks` and `GET /search` accept `q`, `kind=all|aircraft|vessel|satellite`, `bbox=west,south,east,north`, `offset=0`, and `limit=1..5000`. Results carry canonical IDs, sources, units, observation or prediction times, and freshness. Search resolves only available feed identities; it does not discover every physical object or person.

`/world-tracker-client.js` exports `createWorldTrackerClient(base, fetchImpl)`. Each internal app should proxy this API through its existing authenticated backend, preserving its own access rules. The included Home gateway integration is deployment-owned. Do not expose the private Vite service publicly or disable auth/CORS to integrate another app.

Aircraft use the existing quota-governed OpenSky provider and optional local decoders. Set `LOCAL_RECEIVER_FEEDS=1090=http://<private-ip>/tar1090/data/aircraft.json` for a real receiver; do not point this at the projected viewer in this application. The global collector polls every 120 seconds and obeys existing provider caching and credit controls. Source coverage, latency and quotas still apply. The tar1090 JSON projection is display compatibility, not a receiver or a new source of coverage.

For vessels, retain an existing server-side `AISSTREAM_API_KEY`, or set `AIS_CATCHER_URL=http://<private-ip>:8100/geojson` for [AIS-catcher](https://github.com/jvde-github/AIS-catcher), started with its documented `-N 8100 geojson on` option. Only private IPv4 URLs ending `/geojson` are accepted; redirects and embedded credentials are refused. No radio hardware is supplied by this integration. AIS-catcher reception is regional. A `last_signal` timestamp describes reception and does not prove the position-fix time; such positions remain explicitly unknown-age unless a position timestamp is supplied.

Satellite positions use existing [CelesTrak](https://celestrak.org/) orbital data and satellite.js SGP4. They are predictions, not telemetry. Catalog refresh is cached for six hours; predictions include orbital epoch and calculation time. Elements older than seven days are flagged. No photorealistic live imagery is implied. Dataset/provider rights remain separate from application licenses.

Polling runs once per application server, even without an open browser. Payloads are capped at 16 MiB; retries back off and last-good observations expire after 30 minutes. Optional receiver failures stay isolated. A service supervisor must restart the process and enable it at boot. Boot configuration is not proof of power-cycle recovery.

## Local deterministic preferences

The console aggregates successful explicit searches by domain, filter selections, selected-contact domain and visible-view dwell time. It stores only aircraft/vessel/satellite counters by day and local hour under homeWorldPreferences.v1; no query text, object identities, coordinates or gaze data. Retention is30days with bounded counters. Background feed refreshes do not count as searches. Hidden time is excluded and long delays are capped at30seconds per sample. Suggestions use recency and time-of-day weights and apply only when selected; pins are preserved. Pause survives reopen; Reset clears only this preference model; Export downloads aggregate JSON. Storage failure remains session-only and is labeled. This does not rank internal repositories or fleet alerts.

## Planetary event focus

The network console reads the native earthquake layer's existing in-memory USGS snapshot through a same-origin, curated frame message. It adds no collector, bus or model call. The first valid snapshot is a baseline. Only new worldwide M6+ events within one hour qualify; deduplication retains at most512 public event IDs and timestamps for24hours locally. Source updates older than90seconds and bridge snapshots older than30seconds are unavailable. Automatic focus has a five-minute cooldown committed after successful acknowledgment, yields to tracking, hidden pages, pause, held pointers and recent manual input (120seconds), and checks parent authority again at execution. Unknown acknowledgment pauses automatic work. Return uses the camera pose captured when execution starts. Manual focus, pause/resume and Return remain explicit controls. Existing manual embed integration remains compatible; new automatic views and snapshot exchange require the exact same origin. No framing/auth policy was relaxed.

Local M4+ criteria are unavailable without verified property coordinates. FIRMS focus is unavailable while the existing server reports no key; no key or paid API is provisioned. These source/controller tests do not prove a rendered physical client, real-event delivery, uninterrupted operation, eye tracking or global complete coverage.

On Windows the existing native task launcher uses Vite’s supported native configuration loader, avoiding a separate esbuild configuration-bundle process during startup. Configuration dependencies therefore require restarting the same task after changes; application hot reload remains available. No new supervisor or task is created.
