import { MainPage } from './components/mainPage/MainPage';
import { MapLibreMapAdapter } from './adapters/maplibre/MapLibreMapAdapter';
import { MapEntityConnector } from './adapters/maplibre/MapEntityConnector';
import { FileEntityDataConnector } from './adapters/file/FileEntityDataConnector';
import { NominatimGeocodingConnector } from './adapters/nominatim/NominatimGeocodingConnector';
import { activeEntityConfig } from './config/entityConfig';

// Composition root: the only place that knows which concrete map/entity/
// geocoding connector is plugged in. Swapping to Google Maps, for example,
// means writing a GoogleMapConnector (+ optionally a Google geocoding
// connector) and changing only the `new` calls below.
//
// Entity records come from an EntityDataOutlet "outlet". Today that's a
// local data file; once the data outgrows a file, a database-backed
// EntityDataOutlet connector replaces FileEntityDataConnector on the line
// below and nothing else changes - MapEntityConnector still does the
// rendering and the exact radius filtering in the browser.
const mapAdapter = new MapLibreMapAdapter();
const entityDataSource = new FileEntityDataConnector();
const entityProvider = new MapEntityConnector(mapAdapter, entityDataSource);
const geocodingProvider = new NominatimGeocodingConnector();

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root element');

const mainPage = new MainPage(root, {
  mapAdapter,
  entityProvider,
  geocodingProvider,
  entityConfig: activeEntityConfig
});

void mainPage.mount();
