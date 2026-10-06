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
  implement: `MapAdapter` (pure map mechanics: mount/flyTo/marker/lock-interaction — knows
  nothing about entity categories), `EntityProvider` (finds/surfaces POIs matching an
  `EntityConfig` and reports clicks), `GeocodingProvider` (address → coordinates,
  coordinates → address/phone).
- **Connectors** (`src/adapters/`) — concrete implementations of those interfaces. Today:
  `maplibre/MapLibreMapAdapter` + `MapLibreEntityProvider` (MapLibre GL JS over OpenFreeMap's
  "bright" vector tile style), and `nominatim/NominatimGeocodingProvider` (OpenStreetMap's
  Nominatim, used for both geocoding and reverse-geocode/phone lookup). Adding a new map
  vendor (e.g. Google Maps) means writing a new adapter behind the same interfaces — the
  plugs and the composition root's shape don't change.
- **Composition root** (`src/main.ts`) — the only file that knows which concrete adapters are
  wired together. This is where you'd swap in a different connector.
- **Entity category is config, not code** (`src/config/entityConfig.ts`) — which POI category
  is shown (restaurants, clothing stores, ...) is a single `EntityConfig` object
  (`categoryValues` matched against the data source's own class/category field). Retargeting
  the whole app at a different category should only ever require changing this file.

Shared, provider-agnostic logic lives in `src/utils/`: `distance.ts` (Haversine — plain math,
deliberately not behind an interface, since there's nothing to swap) and `usAddress.ts` (US
mailing-address formatting: abbreviated street suffix, two-line `street` / `City, ST zip`
with no comma before the zip; non-US addresses keep full state names and the country).

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
  Showing "all entities within N miles" at a zoomed-out view would require a separate
  radius-search data source (e.g. Overpass API), not a style tweak.
- Distance is shown as straight-line (Haversine), not driving time, deliberately: it's pure
  client-side math with no network cost, whereas driving time would need an external routing
  API call per click.
