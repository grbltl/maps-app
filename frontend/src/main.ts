import { MainPage } from './components/mainPage/MainPage';
import { MapLibreMapAdapter } from './adapters/maplibre/MapLibreMapAdapter';
import { MapEntityProvider } from './adapters/maplibre/MapEntityProvider';
import { FileEntityDataSource } from './adapters/file/FileEntityDataSource';
import { NominatimGeocodingProvider } from './adapters/nominatim/NominatimGeocodingProvider';
import { activeEntityConfig } from './config/entityConfig';

// Composition root: the only place that knows which concrete map/entity/
// geocoding vendor is plugged in. Swapping to Google Maps, for example,
// means writing a GoogleMapAdapter (+ optionally a Google geocoding
// provider) and changing only the `new` calls below.
//
// Entity records come from an EntityDataSource "socket". Today that's a
// local data file; once the data outgrows a file, a database-backed
// EntityDataSource replaces FileEntityDataSource on the line below and
// nothing else changes - MapEntityProvider still does the rendering and the
// exact radius filtering in the browser.
const mapAdapter = new MapLibreMapAdapter();
const entityDataSource = new FileEntityDataSource();
const entityProvider = new MapEntityProvider(mapAdapter, entityDataSource);
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
