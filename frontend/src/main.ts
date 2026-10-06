import { MainPage } from './components/mainPage/MainPage';
import { MapLibreMapAdapter } from './adapters/maplibre/MapLibreMapAdapter';
import { OverpassEntityProvider } from './adapters/overpass/OverpassEntityProvider';
import { NominatimGeocodingProvider } from './adapters/nominatim/NominatimGeocodingProvider';
import { activeEntityConfig } from './config/entityConfig';

// Composition root: the only place that knows which concrete map/entity/
// geocoding vendor is plugged in. Swapping to Google Maps, for example,
// means writing a GoogleMapAdapter (+ optionally a Google geocoding
// provider) and changing only the `new` calls below.
//
// OverpassEntityProvider (radius search against OpenStreetMap's Overpass
// API) is used here instead of MapLibreEntityProvider (filtering the base
// style's own vector-tile POI layers) because the base style's tiles only
// reliably carry POI data at close zoom - Overpass can answer "every
// <category> within N miles" regardless of map zoom. MapLibreEntityProvider
// still exists as a valid, simpler alternative EntityProvider implementation.
const mapAdapter = new MapLibreMapAdapter();
const entityProvider = new OverpassEntityProvider(mapAdapter);
const geocodingProvider = new NominatimGeocodingProvider();

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root element');

const mainPage = new MainPage(root, {
  mapAdapter,
  entityProvider,
  geocodingProvider,
  entityConfig: activeEntityConfig
});

void mainPage.mount();
