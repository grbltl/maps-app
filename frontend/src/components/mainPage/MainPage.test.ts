import { describe, expect, it } from 'vitest';
import { MainPage, type MainPageDeps } from './MainPage';
import type { MapAdapter } from '../../core/interfaces/MapAdapter';
import type { EntityClickHandler, EntityProvider } from '../../core/interfaces/EntityProvider';
import type { GeocodingProvider } from '../../core/interfaces/GeocodingProvider';
import type { Coordinates, EntityConfig, EntityDetails } from '../../core/types';
import { haversineDistanceMiles, formatDistanceMiles } from '../../utils/distance';

class FakeMapAdapter implements MapAdapter {
  mountCalls: HTMLElement[] = [];
  flyToCalls: Array<{ coordinates: Coordinates; zoom: number }> = [];
  markerCalls: Coordinates[] = [];
  locked = false;

  async mount(container: HTMLElement): Promise<void> {
    this.mountCalls.push(container);
  }
  flyTo(coordinates: Coordinates, zoom: number): void {
    this.flyToCalls.push({ coordinates, zoom });
  }
  setMarker(coordinates: Coordinates): void {
    this.markerCalls.push(coordinates);
  }
  lockInteraction(): void {
    this.locked = true;
  }
  unlockInteraction(): void {
    this.locked = false;
  }
  getNativeMap(): unknown {
    return null;
  }
}

class FakeEntityProvider implements EntityProvider {
  activateCalls: EntityConfig[] = [];
  trigger: EntityClickHandler | null = null;

  activate(config: EntityConfig, onEntityClick: EntityClickHandler): void {
    this.activateCalls.push(config);
    this.trigger = onEntityClick;
  }
}

class FakeGeocodingProvider implements GeocodingProvider {
  geocodeQueue: Array<Coordinates | null> = [];
  detailsResult: EntityDetails = {
    address: ['18484 Preston Rd', 'Dallas, TX 75252'],
    phone: '+1-469-497-1415'
  };
  geocodeCalls: string[] = [];
  detailsCalls: Coordinates[] = [];

  async geocode(query: string): Promise<Coordinates | null> {
    this.geocodeCalls.push(query);
    return this.geocodeQueue.shift() ?? null;
  }
  async getEntityDetails(coordinates: Coordinates): Promise<EntityDetails> {
    this.detailsCalls.push(coordinates);
    return this.detailsResult;
  }
}

function fakeGeolocation(result: Coordinates | 'deny'): Geolocation {
  return {
    getCurrentPosition: (success: PositionCallback, error?: PositionErrorCallback) => {
      if (result === 'deny') {
        error?.({ code: 1, message: 'denied' } as GeolocationPositionError);
      } else {
        success({ coords: { longitude: result.lng, latitude: result.lat } } as GeolocationPosition);
      }
    }
  } as unknown as Geolocation;
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function setup(overrides: Partial<MainPageDeps> = {}) {
  const root = document.createElement('div');
  const mapAdapter = new FakeMapAdapter();
  const entityProvider = new FakeEntityProvider();
  const geocodingProvider = new FakeGeocodingProvider();
  const entityConfig: EntityConfig = { label: 'Restaurant', categoryValues: ['restaurant'] };

  const mainPage = new MainPage(root, {
    mapAdapter,
    entityProvider,
    geocodingProvider,
    entityConfig,
    geolocation: fakeGeolocation({ lng: -96.8, lat: 33.05 }),
    ...overrides
  });

  return { root, mapAdapter, entityProvider, geocodingProvider, entityConfig, mainPage };
}

describe('MainPage', () => {
  it('mounts the map adapter and activates the entity provider with the configured category', async () => {
    const { mapAdapter, entityProvider, entityConfig, mainPage } = setup();
    await mainPage.mount();
    expect(mapAdapter.mountCalls).toHaveLength(1);
    expect(entityProvider.activateCalls).toEqual([entityConfig]);
  });

  it('searching an address geocodes it and flies the map there', async () => {
    const { root, mapAdapter, geocodingProvider, mainPage } = setup();
    geocodingProvider.geocodeQueue.push({ lng: -96.77, lat: 33.0 });
    await mainPage.mount();

    (root.querySelector('input') as HTMLInputElement).value = '123 Main St';
    root.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flushPromises();

    expect(geocodingProvider.geocodeCalls).toEqual(['123 Main St']);
    expect(mapAdapter.flyToCalls).toEqual([{ coordinates: { lng: -96.77, lat: 33.0 }, zoom: 16 }]);
  });

  it('locks in the first resolved location for the session and keeps using it for distance after later searches', async () => {
    const firstLocation = { lng: -96.8, lat: 33.05 };
    const secondLocation = { lng: -95.0, lat: 29.76 }; // a different city entirely
    const entityCoordinates = { lng: -96.795134, lat: 33.0023862 };

    const { root, geocodingProvider, entityProvider, mainPage } = setup();
    geocodingProvider.geocodeQueue.push(firstLocation, secondLocation);
    await mainPage.mount();

    const submitSearch = (value: string) => {
      (root.querySelector('input') as HTMLInputElement).value = value;
      root.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    };

    submitSearch('first address');
    await flushPromises();
    submitSearch('second address, far away');
    await flushPromises();

    entityProvider.trigger?.({ name: 'Adamos Pizzas', coordinates: entityCoordinates });
    await flushPromises();

    const expectedDistance = formatDistanceMiles(haversineDistanceMiles(firstLocation, entityCoordinates));
    const lines = Array.from(root.querySelectorAll('.modal-details p')).map((p) => p.textContent);
    expect(lines).toContain(expectedDistance);
  });

  it('clicking an entity opens the modal with its name, and fills in address/phone/distance as they resolve', async () => {
    const { root, entityProvider, mainPage } = setup();
    await mainPage.mount();

    entityProvider.trigger?.({ name: 'Adamos Pizzas', coordinates: { lng: -96.795134, lat: 33.0023862 } });

    // Before anything resolves, both pieces show a loading placeholder.
    expect(root.querySelector('.modal-title')?.textContent).toBe('Adamos Pizzas');
    expect(root.querySelector('.modal-backdrop')?.classList.contains('hidden')).toBe(false);

    await flushPromises();

    const lines = Array.from(root.querySelectorAll('.modal-details p')).map((p) => p.textContent);
    expect(lines).toContain('+1-469-497-1415');
    expect(lines.some((line) => line?.endsWith('mi away'))).toBe(true);
  });

  it('opening the modal locks map interaction; the exit button unlocks it', async () => {
    const { root, mapAdapter, entityProvider, mainPage } = setup();
    await mainPage.mount();

    entityProvider.trigger?.({ name: 'Adamos Pizzas', coordinates: { lng: -96.795134, lat: 33.0023862 } });
    expect(mapAdapter.locked).toBe(true);

    (root.querySelector('.modal-close') as HTMLElement).click();
    expect(mapAdapter.locked).toBe(false);
  });

  it('shows an error status when geolocation is denied, without ever opening the modal', async () => {
    const { root, mainPage } = setup({ geolocation: fakeGeolocation('deny') });
    await mainPage.mount();

    const locateButton = Array.from(root.querySelectorAll('button')).find(
      (b) => b.textContent === 'Use current location'
    ) as HTMLButtonElement;
    locateButton.click();
    await flushPromises();

    expect(root.querySelector('.status')?.textContent).toBe('Location access denied or unavailable.');
    expect(root.querySelector('.modal-backdrop')?.classList.contains('hidden')).toBe(true);
  });

  it('using current location recenters the map at the resolved coordinates', async () => {
    const { root, mapAdapter, mainPage } = setup();
    await mainPage.mount();

    const locateButton = Array.from(root.querySelectorAll('button')).find(
      (b) => b.textContent === 'Use current location'
    ) as HTMLButtonElement;
    locateButton.click();
    await flushPromises();

    expect(mapAdapter.flyToCalls).toEqual([{ coordinates: { lng: -96.8, lat: 33.05 }, zoom: 16 }]);
  });
});
