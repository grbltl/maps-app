import { describe, expect, it } from 'vitest';
import { MainPage, type MainPageDeps } from './MainPage';
import type { MapOutlet } from '../../core/interfaces/MapOutlet';
import type { EntityClickHandler, EntityProviderOutlet } from '../../core/interfaces/EntityProviderOutlet';
import type { GeocodingOutlet } from '../../core/interfaces/GeocodingOutlet';
import type { BoundingBox, Coordinates, EntityConfig, Entity } from '../../core/types';
import { haversineDistanceMiles, formatDistanceMiles } from '../../utils/distance';
import { boundsFromCoordinates, buildCirclePolygonCoordinates } from '../../utils/geoCircle';

class FakeMapAdapter implements MapOutlet {
  mountCalls: HTMLElement[] = [];
  flyToCalls: Array<{ coordinates: Coordinates; zoom: number }> = [];
  fitBoundsCalls: BoundingBox[] = [];
  markerCalls: Coordinates[] = [];
  locked = false;

  async mount(container: HTMLElement): Promise<void> {
    this.mountCalls.push(container);
  }
  flyTo(coordinates: Coordinates, zoom: number): void {
    this.flyToCalls.push({ coordinates, zoom });
  }
  fitBounds(bounds: BoundingBox): void {
    this.fitBoundsCalls.push(bounds);
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

class FakeEntityProvider implements EntityProviderOutlet {
  activateCalls: EntityConfig[] = [];
  showNearCalls: Array<{ center: Coordinates; radiusMiles: number }> = [];
  trigger: EntityClickHandler | null = null;
  showNearShouldFail = false;

  activate(config: EntityConfig, onEntityClick: EntityClickHandler): void {
    this.activateCalls.push(config);
    this.trigger = onEntityClick;
  }

  async showNear(center: Coordinates, radiusMiles: number): Promise<void> {
    this.showNearCalls.push({ center, radiusMiles });
    if (this.showNearShouldFail) throw new Error('data source failed');
  }
}

class FakeGeocodingProvider implements GeocodingOutlet {
  geocodeQueue: Array<Coordinates | null> = [];
  geocodeCalls: string[] = [];

  async geocode(query: string): Promise<Coordinates | null> {
    this.geocodeCalls.push(query);
    return this.geocodeQueue.shift() ?? null;
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

// The exact 5-mile bounds MainPage computes for whichever coordinates first
// lock in as "current location" - mirrors production so these tests verify
// real behavior, not a hardcoded guess at the expected numbers.
const LOCK_RADIUS_MILES = 5;
function expectedLockBounds(center: Coordinates): BoundingBox {
  return boundsFromCoordinates(buildCirclePolygonCoordinates(center, LOCK_RADIUS_MILES));
}

function setup(overrides: Partial<MainPageDeps> = {}) {
  const root = document.createElement('div');
  const mapAdapter = new FakeMapAdapter();
  const entityProvider = new FakeEntityProvider();
  const geocodingProvider = new FakeGeocodingProvider();
  const entityConfig: EntityConfig = {
    label: 'Restaurant',
    categoryValues: ['restaurant']
  };

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

  it('searching an address geocodes it and instantly fits the camera to the search-radius area (the locking search, not a flyTo)', async () => {
    const { root, mapAdapter, geocodingProvider, mainPage } = setup();
    const coordinates = { lng: -96.77, lat: 33.0 };
    geocodingProvider.geocodeQueue.push(coordinates);
    await mainPage.mount();

    (root.querySelector('input') as HTMLInputElement).value = '123 Main St';
    root.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flushPromises();

    expect(geocodingProvider.geocodeCalls).toEqual(['123 Main St']);
    expect(mapAdapter.fitBoundsCalls).toEqual([expectedLockBounds(coordinates)]);
    expect(mapAdapter.flyToCalls).toEqual([]);
  });

  it('a later search (after the first lock) still flies to the point instead of re-fitting the whole area', async () => {
    const firstLocation = { lng: -96.8, lat: 33.05 };
    const secondLocation = { lng: -95.0, lat: 29.76 };

    const { root, mapAdapter, geocodingProvider, mainPage } = setup();
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

    expect(mapAdapter.fitBoundsCalls).toEqual([expectedLockBounds(firstLocation)]);
    expect(mapAdapter.flyToCalls).toEqual([{ coordinates: secondLocation, zoom: 16 }]);
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

  it('triggers showNear once the first location is resolved, and not again on a later search', async () => {
    const { root, geocodingProvider, entityProvider, mainPage } = setup();
    geocodingProvider.geocodeQueue.push({ lng: -96.77, lat: 33.0 }, { lng: -95.0, lat: 29.76 });
    await mainPage.mount();

    const submitSearch = (value: string) => {
      (root.querySelector('input') as HTMLInputElement).value = value;
      root.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    };

    submitSearch('first address');
    await flushPromises();
    submitSearch('second address, far away');
    await flushPromises();

    expect(entityProvider.showNearCalls).toEqual([{ center: { lng: -96.77, lat: 33.0 }, radiusMiles: 5 }]);
  });

  it('surfaces a status message (but still locks in the location and fits the camera) when showNear rejects', async () => {
    const { root, mapAdapter, geocodingProvider, entityProvider, mainPage } = setup();
    entityProvider.showNearShouldFail = true;
    const coordinates = { lng: -96.77, lat: 33.0 };
    geocodingProvider.geocodeQueue.push(coordinates);
    await mainPage.mount();

    (root.querySelector('input') as HTMLInputElement).value = '123 Main St';
    root.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flushPromises();

    expect(root.querySelector('.status')?.textContent).toBe('Could not load nearby restaurants - try reloading the page.');
    expect(mapAdapter.fitBoundsCalls).toEqual([expectedLockBounds(coordinates)]);
  });

  it('does not re-show the showNear failure status on a later, already-locked search', async () => {
    const firstLocation = { lng: -96.77, lat: 33.0 };
    const secondLocation = { lng: -95.0, lat: 29.76 };

    const { root, geocodingProvider, entityProvider, mainPage } = setup();
    entityProvider.showNearShouldFail = true;
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

    expect(root.querySelector('.status')?.textContent).toBe('');
  });

  it('clicking an entity shows every detail its data source provided, plus distance once resolved', async () => {
    const { root, entityProvider, mainPage } = setup();
    await mainPage.mount();

    const entity: Entity = {
      name: 'Adamos Pizzas',
      coordinates: { lng: -96.795134, lat: 33.0023862 },
      details: {
        address: ['18484 Preston Rd', 'Dallas, TX 75252'],
        phone: '+1-469-497-1415',
        website: 'adamospizzas.example',
        hours: 'Mon-Sun 11am-10pm',
        cuisine: 'Pizza',
        deals: [
          { description: '2-for-1 slices' },
          { description: 'Expired deal', endDate: '2000-01-01' }
        ]
      }
    };
    entityProvider.trigger?.(entity);

    expect(root.querySelector('.modal-title')?.textContent).toBe('Adamos Pizzas');
    expect(root.querySelector('.modal-backdrop')?.classList.contains('hidden')).toBe(false);

    await flushPromises();

    const lines = Array.from(root.querySelectorAll('.modal-details p')).map((p) => p.textContent);
    expect(lines.some((line) => line?.endsWith('mi away'))).toBe(true);
    expect(lines).toContain('Pizza');
    expect(lines).toContain('18484 Preston RdDallas, TX 75252');
    expect(lines).toContain('+1-469-497-1415');
    expect(lines).toContain('Mon-Sun 11am-10pm');
    expect(lines.some((line) => line?.includes('2-for-1 slices'))).toBe(true);
    expect(lines.some((line) => line?.includes('Expired deal'))).toBe(false);

    const link = root.querySelector('.modal-details a') as HTMLAnchorElement;
    expect(link.textContent).toBe('adamospizzas.example');
    expect(link.href).toBe('https://adamospizzas.example/');
  });

  it('leaves out details the entity does not have', async () => {
    const { root, entityProvider, mainPage } = setup({ geolocation: null });
    await mainPage.mount();

    entityProvider.trigger?.({ name: 'Bare Bones Cafe', coordinates: { lng: -96.79, lat: 33.0 } });
    await flushPromises();

    expect(root.querySelectorAll('.modal-details p')).toHaveLength(0);
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

  it('using current location (the first lock) instantly fits the camera to the search-radius area', async () => {
    const { root, mapAdapter, mainPage } = setup();
    await mainPage.mount();

    const locateButton = Array.from(root.querySelectorAll('button')).find(
      (b) => b.textContent === 'Use current location'
    ) as HTMLButtonElement;
    locateButton.click();
    await flushPromises();

    expect(mapAdapter.fitBoundsCalls).toEqual([expectedLockBounds({ lng: -96.8, lat: 33.05 })]);
    expect(mapAdapter.flyToCalls).toEqual([]);
  });
});
