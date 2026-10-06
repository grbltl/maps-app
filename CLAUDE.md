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
  (title + ordered info lines + exit button; a line can be text, a tight multi-line block, or
  a link — links are only made live for http(s) URLs); it has zero knowledge of maps,
  entities, or geocoding. `MainPage` owns the address-search/locate controls and the map
  container, and wires the Modal to whatever adapters are injected into it via constructor DI
  (`MainPageDeps`). `MainPage` always starts on a world map — that default lives in the map
  adapter's `mount()`, not in `MainPage`.
- **Socket** (`src/core/interfaces/`) — interfaces define the contract any provider must
  implement: `MapAdapter` (pure map mechanics: mount/flyTo/fitBounds/marker/lock-interaction —
  knows nothing about entity categories), `EntityProvider` (surfaces POIs on the map, reports
  clicks, and optionally `showNear(center, radiusMiles)` for providers whose data isn't tied to
  map tiles), `EntityDataSource` (where entity records come from:
  `findNear(center, radiusMiles)` returns *at least* every entity in range — extras are fine,
  since the exact radius filtering always happens in the browser), `GeocodingProvider`
  (address → coordinates, used only by the search box).
- **Connectors** (`src/adapters/`) — concrete implementations of those interfaces.
  `maplibre/MapLibreMapAdapter` is the active `MapAdapter` (MapLibre GL JS over OpenFreeMap's
  "bright" vector tile style). `maplibre/MapEntityProvider` is the active `EntityProvider`: it
  removes the base style's own POI layers, asks the injected `EntityDataSource` for entities,
  keeps only those within the radius (`filterWithinRadius`, Haversine), and renders them as its
  own GeoJSON circle layer (entities with a deal active today get a larger green marker) plus
  a dashed-ring polygon layer showing the exact radius. `file/FileEntityDataSource` is the
  active `EntityDataSource` — the data file and its format aren't decided yet, so it returns
  `[]` and the map shows no entities. A database-backed `EntityDataSource` (calling our own
  backend) is planned for when the data outgrows a file; swapping it in is a one-line change
  in `main.ts`. `maplibre/MapLibreEntityProvider` (filtering the style's own vector-tile POI
  layers) still exists as an alternative `EntityProvider`, not wired up.
  `nominatim/NominatimGeocodingProvider` is the `GeocodingProvider` (address search only).
  Adding a new map vendor (e.g. Google Maps) means writing a new adapter behind the same
  interfaces — the plugs and the composition root's shape don't change.
- **Composition root** (`src/main.ts`) — the only file that knows which concrete adapters are
  wired together. This is where you'd swap in a different connector or data source.
- **Entity category is config, not code** (`src/config/entityConfig.ts`) — which POI category
  is shown (restaurants, clothing stores, ...) is a single `EntityConfig` object.
  `categoryValues` is only used by the tile-filtering `MapLibreEntityProvider`; the active
  data-source path relies on the data source holding only the configured category.
- **`Entity.details`** — everything about an entity comes from its `EntityDataSource`:
  address, phone, website, hours (free text), cuisine, and deals. All optional; the modal
  leaves out whatever is missing (there is no geocoding fallback for missing fields). A `Deal`
  has a `description` and optional inclusive `startDate`/`endDate` (`"YYYY-MM-DD"`, compared
  against the visitor's *local* date); `utils/deals.ts` (`activeDeals`) is the single
  definition of "active today", shared by the marker highlight and the modal.

Shared, provider-agnostic logic lives in `src/utils/`: `distance.ts` (Haversine and
`filterWithinRadius` — plain math, deliberately not behind an interface, since there's
nothing to swap), `deals.ts` (which deals are active today), `usAddress.ts` (US
mailing-address formatting: abbreviated street suffix, two-line `street` / `City, ST zip`
with no comma before the zip; currently unused by app code, kept for formatting structured
addresses once the data file exists), and `geoCircle.ts` (hand-rolled geodesic circle math —
no geometry library dependency — used both to draw the visual search-radius ring and to
compute the `BoundingBox` passed to `MapAdapter.fitBounds()`; always called with the *same*
`radiusMiles` as the entity filter so what's drawn/framed never mismatches what's included).

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
  real tiles). That's one reason entities come from our own `EntityDataSource` rather than the
  base tiles, and why `MapEntityProvider` hides the base style's POI layers.
- **`MainPage.ENTITY_SEARCH_RADIUS_MILES` (5)**: `EntityProvider.showNear()` is called once,
  the same moment "current location" first locks in (see `setCurrentLocationIfUnset`) — not on
  every pan/zoom. A `showNear()` failure is swallowed inside `setCurrentLocationIfUnset`
  (logged, not thrown) and recorded in `MainPage.lastEntitySearchFailed`, which
  `handleSearch`/`handleLocate` check right after awaiting it to show a status message — it's
  *not* set directly as a status message from inside `setCurrentLocationIfUnset` itself,
  because both callers unconditionally clear/overwrite the status line immediately afterward
  for their own "Searching.../Locating..." lifecycle, which would silently wipe out an error
  message set there.
- **The locking search/locate instantly `fitBounds`s to the whole search-radius area instead of
  `flyTo`-ing to a point** — computed and applied *before* `showNear()` is awaited, so the
  camera snap doesn't wait on the data source. `MapEntityProvider` likewise draws the ring
  before awaiting the data source. `flyTo` to street-level zoom still happens for any
  *subsequent* search after the lock (ordinary "look at this other place" navigation,
  unrelated to the locked distance anchor) — both `handleSearch` and `handleLocate` capture
  `isFirstLock` before resolving, specifically to decide this.
- Distance is shown as straight-line (Haversine), not driving time, deliberately: it's pure
  client-side math with no network cost, whereas driving time would need an external routing
  API call per click.
