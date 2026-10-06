# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

An interactive map app (`frontend/`) built as a Vite + TypeScript project, plus `backend/`
(currently empty, reserved for future backend work).

## Commands (run from `frontend/`)

- `npm install` — install dependencies.
- `npm run dev` — start the Vite dev server.
- `npm run build` — type-check (`tsc --noEmit`) then production-build.
- `npm test` — run the Vitest suite once; `npm run test:watch` to watch.
- Run a single test file: `npx vitest run src/utils/distance.test.ts`.

## Architecture: ports and adapters

The app is split into two layers that must stay decoupled:

- **Plugs** (`src/components/`) — reusable UI, provider-agnostic. `Modal` is a generic dialog
  (title + ordered info lines + exit button); it has zero knowledge of maps, entities, or
  geocoding. `MainPage` owns the address-search/locate controls and the map container, and
  wires the Modal to whatever adapters are injected into it via constructor DI
  (`MainPageDeps`). `MainPage` always starts on a world map — that default lives in the map
  adapter's `mount()`, not in `MainPage`.
- **Socket** (`src/core/interfaces/`) — three interfaces define the contract any provider must
  implement: `MapAdapter` (pure map mechanics: mount/flyTo/fitBounds/marker/lock-interaction —
  knows nothing about entity categories), `EntityProvider` (finds/surfaces POIs matching an
  `EntityConfig`, reports clicks, and optionally `showNear(center, radiusMiles)` for providers
  that can do a live radius search independent of map tiles), `GeocodingProvider` (address →
  coordinates, coordinates → address/phone).
- **Connectors** (`src/adapters/`) — concrete implementations of those interfaces.
  `maplibre/MapLibreMapAdapter` is the active `MapAdapter` (MapLibre GL JS over OpenFreeMap's
  "bright" vector tile style). `overpass/OverpassEntityProvider` is the active
  `EntityProvider` — it removes the base style's own POI layers and instead does a live radius
  search against OpenStreetMap's Overpass API (free, no key), rendering results as its own
  GeoJSON source/circle layer plus a dashed-ring GeoJSON polygon layer showing the exact area
  searched; this is what actually answers "every restaurant within 5 miles," since the base
  style's tiles can't (see below). `maplibre/MapLibreEntityProvider` (filtering the style's own
  vector-tile POI layers) still exists as a simpler, valid alternative `EntityProvider`
  implementation, just not the one wired up by default.
  `nominatim/NominatimGeocodingProvider` is the `GeocodingProvider` (used for address search,
  and as the reverse-geocode/phone fallback when an `EntityProvider` doesn't already have that
  data — see `Entity.details` below). Adding a new map vendor (e.g. Google Maps) means writing
  a new adapter behind the same interfaces — the plugs and the composition root's shape don't change.
- **Composition root** (`src/main.ts`) — the only file that knows which concrete adapters are
  wired together. This is where you'd swap in a different connector.
- **Entity category is config, not code** (`src/config/entityConfig.ts`) — which POI category
  is shown (restaurants, clothing stores, ...) is a single `EntityConfig` object with two
  parallel fields for two different kinds of provider: `categoryValues` (a vector tile's shared
  "class" property, for tile-filtering providers) and `osmTag` (a real OSM key/value pair, e.g.
  `{key: "amenity", values: ["restaurant"]}`, for tag-query providers like Overpass — OSM splits
  categories across different keys entirely, not just different values of one property).
  Retargeting the whole app at a different category should only ever require changing this file.
- **`Entity.details`** — an `EntityProvider` can pre-fill an entity's address/phone directly
  (e.g. `OverpassEntityProvider` reads them straight from OSM `addr:*`/`phone` tags in the same
  query that found the entity). `MainPage.showEntityModal` uses whichever fields are already
  present and only calls `GeocodingProvider.getEntityDetails()` for ones that are missing —
  skipping it entirely when a provider already supplied everything.

Shared, provider-agnostic logic lives in `src/utils/`: `distance.ts` (Haversine — plain math,
deliberately not behind an interface, since there's nothing to swap), `usAddress.ts` (US
mailing-address formatting: abbreviated street suffix, two-line `street` / `City, ST zip`
with no comma before the zip; non-US addresses keep full state names and the country), and
`geoCircle.ts` (hand-rolled geodesic circle math — no geometry library dependency — used both
to draw the visual search-radius ring and to compute the `BoundingBox` passed to
`MapAdapter.fitBounds()`; always called with the *same* `radiusMiles` as the entity search so
what's drawn/framed never mismatches what was actually searched).

## Known constraints/decisions worth preserving

- **Location privacy**: the visitor's location (from geolocation or a typed address) is kept
  in-memory only (a plain variable, not even `localStorage`) and is never sent to a backend or
  persisted anywhere. Keep this true when backend work starts.
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
- **Restaurant/POI data is zoom-limited by the tile source, not just the style**: OpenFreeMap's
  planet tiles have `maxzoom: 14` (zoom 15–17 is MapLibre overzooming the same z14 tile), and
  POI data is sparse-to-absent below z14 in the raw tiles themselves (verified by decoding
  real tiles) — not merely hidden by the style's `minzoom`. Don't assume lowering a layer's
  `minzoom` will surface more POIs at low zoom; it won't, because the data isn't in the tile.
  This is why the active `EntityProvider` is `OverpassEntityProvider`, not the tile-filtering
  one — Overpass's radius search is independent of map zoom/tiles entirely.
- **`MainPage.ENTITY_SEARCH_RADIUS_MILES` (5)**: `OverpassEntityProvider.showNear()` is called
  once, the same moment "current location" first locks in (see `setCurrentLocationIfUnset`) —
  not on every pan/zoom, to avoid hammering Overpass's free, rate-limited public instance. A
  `showNear()` failure is swallowed inside `setCurrentLocationIfUnset` (logged, not thrown) and
  recorded in `MainPage.lastEntitySearchFailed`, which `handleSearch`/`handleLocate` check right
  after awaiting it to show a status message — it's *not* set directly as a status message from
  inside `setCurrentLocationIfUnset` itself, because both callers unconditionally clear/overwrite
  the status line immediately afterward for their own "Searching.../Locating..." lifecycle, which
  would silently wipe out an error message set there.
- **Overpass has no single point of failure**: `OverpassEntityProvider` tries
  `OVERPASS_ENDPOINTS` (overpass-api.de, kumi.systems, openstreetmap.ru) in order, each capped at
  20s via `AbortSignal.timeout` (just under the query's own `[timeout:25]` server-side budget),
  first success wins. Confirmed firsthand that overpass-api.de can fail *every* request (even a
  trivial empty query) with a raw Apache `406`/`506` — a real server-side fault unrelated to
  query content, not just an occasional rate-limit — so depending on one host isn't safe.
  Candidates must carry full-planet data: `overpass.osm.ch` was tried and rejected because it
  responds fast with a *valid but empty* result for any query outside its (regional, Swiss)
  coverage — worse than an honest failure, since it wins the race and silently reports "no
  entities" instead of letting a mirror that actually has the data get a turn.
- **The locking search/locate instantly `fitBounds`s to the whole search-radius area instead of
  `flyTo`-ing to a point** — computed and applied *before* `showNear()` is awaited, so the
  camera snap doesn't wait on Overpass's (sometimes slow) response. `flyTo` to street-level zoom
  still happens for any *subsequent* search after the lock (ordinary "look at this other place"
  navigation, unrelated to the locked distance anchor) — both `handleSearch` and `handleLocate`
  capture `isFirstLock` before resolving, specifically to decide this.
- Distance is shown as straight-line (Haversine), not driving time, deliberately: it's pure
  client-side math with no network cost, whereas driving time would need an external routing
  API call per click.
