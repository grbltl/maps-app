import { MainPage } from './components/mainPage/MainPage';
import { MapLibreMapAdapter } from './adapters/maplibre/MapLibreMapAdapter';
import { MapLibreEntityProvider } from './adapters/maplibre/MapLibreEntityProvider';
import { NominatimGeocodingProvider } from './adapters/nominatim/NominatimGeocodingProvider';
import { activeEntityConfig } from './config/entityConfig';

// Composition root: the only place that knows which concrete map/geocoding
// vendor is plugged in. Swapping to Google Maps, for example, means writing
// a GoogleMapAdapter + GoogleEntityProvider (+ optionally a Google geocoding
// provider) and changing only the three `new` calls below.
const mapAdapter = new MapLibreMapAdapter();
const entityProvider = new MapLibreEntityProvider(mapAdapter);
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
