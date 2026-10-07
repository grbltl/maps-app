# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

An interactive map app (`frontend/`) built as a Vite + TypeScript project, plus `backend/`
(currently empty, reserved for future backend work).

## Commands (run from `frontend/`)

- `npm install` — install dependencies.
- `npm run dev` — start the Vite dev server.
- `npm run dev:phone` — dev server on the LAN over https (self-signed cert). Use this to test on
  a phone: geolocation only works on secure pages, so plain-http LAN testing always fails "locate".
- `npm run build` — type-check (`tsc --noEmit`) then production-build.
- `npm test` — run the Vitest suite once; `npm run test:watch` to watch.
- Run a single test file: `npx vitest run src/utils/distance.test.ts`.

## Architecture: ports and adapters

The app is split into two layers that must stay decoupled:

- **Plugs** (`src/components/`) — reusable UI, provider-agnostic. `Modal` is a generic dialog
  (title + ordered info lines + exit button; a line can be text, a tight multi-line block, or
  a link — links are only made live for http(s) URLs); it has zero knowledge of maps,
  entities, or geocoding. `Toast` is likewise generic (bottom-center pill, message + optional
  action button, fades out after ~6 s). `MainPage` owns the address-search/locate controls and the map
  container, and wires the Modal to whatever connectors are injected into it via constructor DI
  (`MainPageDeps`). `MainPage` always starts on a world map — that default lives in the map
  connector's `mount()`, not in `MainPage`.
- **Outlets** (`src/core/interfaces/`) — interfaces define the contract any connector must
  implement: `MapOutlet` (pure map mechanics: mount/flyTo/fitBounds/marker/lock-interaction —
  knows nothing about entity categories), `EntityProviderOutlet` (surfaces POIs on the map,
  reports clicks, and optionally `showNear(center, radiusMiles)` for connectors whose data isn't
  tied to map tiles), `EntityDataOutlet` (where entity records come from:
  `findNear(center, radiusMiles)` returns *at least* every entity in range — extras are fine,
  since the exact radius filtering always happens in the browser), `GeocodingOutlet`
  (address → coordinates, used only by the search box).
- **Connectors** (`src/adapters/`) — concrete implementations of those interfaces, each file/class
  named with an `Adapter` or `Connector` suffix. `maplibre/MapLibreMapAdapter` is the active
  `MapOutlet` connector (MapLibre GL JS over OpenFreeMap's "bright" vector tile style).
  `maplibre/MapEntityConnector` is the active `EntityProviderOutlet` connector: it removes the
  base style's own POI layers, asks the injected `EntityDataOutlet` for entities, keeps only
  those within the radius (`filterWithinRadius`, Haversine), and renders them as its own GeoJSON
  circle layer (entities with a deal active today get a larger green marker) plus a dashed-ring
  polygon layer showing the exact radius. `file/FileEntityDataConnector` is the active
  `EntityDataOutlet` connector — it fetches `public/restaurants.json` once (cached; a failed
  fetch rejects and is retried on the next call) and maps each flat record (name, lat/lng,
  street/unit/city/state/zip) to an `Entity`, formatting the address with `formatAddressLines`.
  That JSON is generated, never hand-edited — see "Restaurant data" below. A database-backed `EntityDataOutlet` connector (calling our
  own backend) is planned for when the data outgrows a file; swapping it in is a one-line change
  in `main.ts`. Whatever source is plugged in is wrapped in `cache/CachingEntityDataConnector`:
  each real fetch covers 2x the requested radius, and a later search whose circle lies inside an
  already-fetched area is answered from memory (last 4 areas; in-flight fetches shared, failed
  ones forgotten). Redundant for the file, there so the database swap is cheap from day one. `maplibre/MapLibreEntityConnector` (filtering the style's own vector-tile POI
  layers) still exists as an alternative `EntityProviderOutlet` connector, not wired up.
  `nominatim/NominatimGeocodingConnector` is the `GeocodingOutlet` connector (address search
  only). **Address search is currently switched off**: `MainPageDeps.geocodingProvider` is
  optional, `MainPage` renders the search bar only when it's injected, and `main.ts` doesn't
  inject it (a comment there shows the one line to add back). Adding a new map vendor (e.g. Google Maps) means writing a new connector behind the
  same interfaces — the plugs and the composition root's shape don't change.
- **Composition root** (`src/main.ts`) — the only file that knows which concrete connectors are
  wired together. This is where you'd swap in a different connector.
- **Entity category is config, not code** (`src/config/entityConfig.ts`) — which POI category
  is shown (restaurants, clothing stores, ...) is a single `EntityConfig` object.
  `categoryValues` is only used by the tile-filtering `MapLibreEntityConnector`; the active
  data-source path relies on the data source holding only the configured category.
- **`Entity.details`** — everything about an entity comes from its `EntityDataOutlet`:
  address, phone, website, hours (free text), cuisine, and deals. All optional; the modal
  leaves out whatever is missing (there is no geocoding fallback for missing fields). A `Deal`
  has a `description` and optional inclusive `startDate`/`endDate` (`"YYYY-MM-DD"`, compared
  against the visitor's *local* date); `utils/deals.ts` (`activeDeals`) is the single
  definition of "active today", shared by the marker highlight and the modal.

Shared, provider-agnostic logic lives in `src/utils/`: `distance.ts` (Haversine and
`filterWithinRadius` — plain math, deliberately not behind an interface, since there's
nothing to swap), `deals.ts` (which deals are active today), `usAddress.ts` (US
mailing-address formatting: abbreviated street suffix, two-line `street` / `City, ST zip`
with no comma before the zip; a unit that already carries a designator like `SUITE 100` isn't
prefixed with another "Suite"), and `geoCircle.ts` (hand-rolled geodesic circle math —
no geometry library dependency — used both to draw the visual search-radius ring and to
compute the `BoundingBox` passed to `MapOutlet.fitBounds()`; always called with the *same*
`radiusMiles` as the entity filter so what's drawn/framed never mismatches what's included).

## Restaurant data

`frontend/public/restaurants.json` is built from the county restaurant inspection export
(`restaurants-inspection-report.csv` in the repo root, gitignored — not tracked) by
`node scripts/build-restaurant-data.mjs ../restaurants-inspection-report.csv` (run from
`frontend/`, ~5 min). Only the premises name and address (columns 5–10) are kept. The script:

- keeps `1 - Restaurant` rows and de-duplicates by `State ID#` — the CSV has one row per
  inspection, and the **newest inspection's row wins**, so a data fix must go on that row;
- collapses spaces, drops periods, and snaps rare city spellings to a common one within 2
  edits (`CHAROTTE` → `CHARLOTTE`), logging each fix;
- geocodes once at build time, never in the browser: US Census batch geocoder first, then
  Nominatim (1 req/s, up to 3 attempts — its top result varies between calls) for misses.
  A Nominatim result is accepted only if its house number **and** zip match ours; without
  that check it returns similarly named streets elsewhere. County suffixes (`BV`, `PY`, `WY`,
  `HY`, ...) are rewritten to USPS forms for geocoding only — the output keeps the CSV spelling;
- takes hand-entered coordinates from `restaurant-coordinate-overrides.csv` (repo root, keyed
  by `State ID#`, `coordinates` column = `lat, lng` as Google Maps copies it). Those win over
  geocoding. Only the coordinates are read from it — its name/address columns are labels; fix
  displayed addresses in the inspection CSV. The script creates this file only if it's missing
  and never rewrites it; closed/non-restaurant places were deliberately deleted from it and
  stay off the map. Restaurants with no coordinates are listed on the console each run.

A one-field correction (e.g. a wrong state) can be applied to both the CSV and the JSON by
hand to avoid a full rerun, as long as both stay in sync.

## Known constraints/decisions worth preserving

- **Location privacy**: the visitor's location (from geolocation or a typed address) is kept
  in-memory only in the browser (a plain variable, not even `localStorage`). It may be sent
  only to our own backend, only for the entity radius query, and must never be logged or
  persisted there (no DB, cache, or request logs). The exact n-mile filtering is always done
  in the browser.
- **"Current location" is locked once per session**: whichever resolves first — a typed
  address search or the "Use current location" button — wins and is reused for the rest of
  the page's lifetime; neither a later search nor a later click of the button changes it
  (only a reload does). The gating check for "do we have a location source" must go through
  the same DI-aware path (`MainPage.getGeolocation()`) as the actual fetch — checking
  `navigator.geolocation` directly there was a real bug (TypeScript's DOM lib declares it as
  always non-null, which also silently defeated feature detection).
- **Geolocation uses `enableHighAccuracy: false`**: network-based positioning instead of GPS.
  Tens-of-meters accuracy is negligible for a one-decimal "X.X mi away" distance line, and this
  avoids powering up the GPS radio for what's at most one call per session — a deliberate
  battery tradeoff, not an oversight.
- **Base-map POI data is zoom-limited by the tile source, not just the style**: OpenFreeMap's
  planet tiles have `maxzoom: 14` (zoom 15–17 is MapLibre overzooming the same z14 tile), and
  POI data is sparse-to-absent below z14 in the raw tiles themselves (verified by decoding
  real tiles). That's one reason entities come from our own `EntityDataOutlet` rather than the
  base tiles, and why `MapEntityConnector` hides the base style's POI layers.
- **`MainPage.ENTITY_SEARCH_RADIUS_MILES` (5)**: `EntityProviderOutlet.showNear()` first runs the
  moment "current location" locks in (see `setCurrentLocationIfUnset`), around that location.
- **The search ring follows the map, distance doesn't**: after the lock, once the camera has been
  still for `SETTLE_DELAY_MS` (500 ms; a new movement cancels it), `showNear()` re-runs around
  the map center — but not for a move under `MIN_RESEARCH_MOVE_MILES` (0.1), which also stops the
  lock's own `fitBounds` from triggering a duplicate. Never on every pan frame, and never on the
  start-screen world map. Distance in the modal is always from the locked current location.
  `MapEntityConnector.showNear()` is latest-call-wins (a superseded call neither draws nor
  rejects) and drops already-drawn entities outside the new ring immediately, before the data
  arrives.
- **Every entity search goes through `MainPage.searchAround`** (lock-time, settled-map, and
  Retry). It never rejects: a `showNear()` failure is logged and shows the `Toast`
  "Couldn't load restaurants." with a Retry button (re-searches `lastSearchCenter` with the
  spinner); any later successful search hides it. The location/map flow has already succeeded
  either way. `handleSearch`/`handleLocate` hide the toast when they start.
- **The locking search/locate instantly `fitBounds`s to the whole search-radius area instead of
  `flyTo`-ing to a point** — computed and applied *before* `showNear()` is awaited, so the
  camera snap doesn't wait on the data source. `MapEntityConnector` likewise draws the ring
  before awaiting the data source. `flyTo` to street-level zoom still happens for any
  *subsequent* search after the lock (ordinary "look at this other place" navigation,
  unrelated to the locked distance anchor) — both `handleSearch` and `handleLocate` capture
  `isFirstLock` before resolving, specifically to decide this.
- **Only the map zooms, never the page**: `#app` is a `position: fixed` frame with the map and
  the top-left controls inside it. The viewport meta tag blocks page zoom in most browsers, but
  iOS Safari ignores `user-scalable=no`, so `MainPage` also cancels Safari's `gesture*` events
  (MapLibre's pinch uses touch events and is unaffected). The address input must stay ≥16px or
  iOS zooms the page when it's focused. Controls buttons must not shrink (`flex: 0 0 auto`) — WebKit
  clips a squeezed button's label (the likely cause of an empty Search button seen on iPhone).
- **Start screen = world map, drag only**: `MapLibreMapAdapter.mount()` fits the whole world to
  the visible height below the controls panel when shown (`MainPage` reports its bottom edge via
  `MapOutlet.setTopInset`, applied as MapLibre camera padding, so later `fitBounds`/`flyTo` also
  frame below it; re-fitted on resize until the camera first moves), so it can only be
  dragged sideways. `MainPage` calls `setZoomEnabled(false)` after mount and `true` when current
  location locks in. Rotation/pitch are always off.
- **Status-bar strip**: in a Safari tab a page can't draw under the status bar, only tint it.
  `index.html` sets `theme-color` and the html/body background to a neutral gray per
  light/dark mode (`#f7f7f7` / `#1c1c1e`); the map frame (`#app`) keeps the ocean-blue loading
  color. Tried and rejected: matching the strip to the map's top-edge color, and a frosted top
  bar under the strip (read as a second bar in dark mode). There's no top bar.
- **Locate button** (`.locate-fab`, outside the search panel): a labeled blue pill at the bottom
  center on the start screen, gaining `compact` (round, bottom-right re-center button) when
  location locks in. The toast is raised above it via `--toast-bottom`.
- **Search/locate errors use the native validation bubble on the address field** when the
  search bar is shown (`MainPage.showFieldError`: `setCustomValidity` + `reportValidity`),
  including location failures — a `type="button"` can't show one. Without the search bar,
  locate errors go to the toast, with Retry only when it can help (not for denied/insecure). The bubble is cleared on `input` *and* `blur` (tapping Search
  blurs first, so a stale error never blocks the next submit). Progress is a centered
  spinner (`beginBusy`/`endBusy`, counted; fades in after 150 ms so instant results don't flash
  it), not text. There is no status line.
- Distance is shown as straight-line (Haversine), not driving time, deliberately: it's pure
  client-side math with no network cost, whereas driving time would need an external routing
  API call per click.
