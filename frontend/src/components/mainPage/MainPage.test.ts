import { afterEach, describe, expect, it, vi } from 'vitest';
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
  zoomEnabled = true;

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
  setZoomEnabled(enabled: boolean): void {
    this.zoomEnabled = enabled;
  }
  topInsetCalls: Array<{ px: number; mounted: boolean }> = [];
  setTopInset(px: number): void {
    this.topInsetCalls.push({ px, mounted: this.mountCalls.length > 0 });
  }
  private moveStartHandlers: Array<() => void> = [];
  private moveEndHandlers: Array<(center: Coordinates) => void> = [];
  onMoveStart(handler: () => void): void {
    this.moveStartHandlers.push(handler);
  }
  onMoveEnd(handler: (center: Coordinates) => void): void {
    this.moveEndHandlers.push(handler);
  }
  /** Simulates the user dragging the map and it coming to rest at center. */
  drag(center: Coordinates): void {
    this.moveStartHandlers.forEach((handler) => handler());
    this.moveEndHandlers.forEach((handler) => handler(center));
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

function fakeGeolocation(result: Coordinates | 'deny' | 'timeout'): Geolocation {
  return {
    getCurrentPosition: (success: PositionCallback, error?: PositionErrorCallback) => {
      if (result === 'deny') {
        error?.({ code: 1, message: 'denied' } as GeolocationPositionError);
      } else if (result === 'timeout') {
        error?.({ code: 3, message: 'timeout' } as GeolocationPositionError);
      } else {
        success({ coords: { longitude: result.lng, latitude: result.lat } } as GeolocationPosition);
      }
    }
  } as unknown as Geolocation;
}

/** The load-error toast's message while it's showing, else null. */
function shownToast(root: HTMLElement): string | null {
  const toast = root.querySelector('.toast');
  return toast?.classList.contains('visible') ? (toast.querySelector('.toast-message')?.textContent ?? '') : null;
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
    // The controls' inset is reported before the map exists, so the first
    // frame already fits the world below them.
    expect(mapAdapter.topInsetCalls[0]?.mounted).toBe(false);
    expect(entityProvider.activateCalls).toEqual([entityConfig]);
  });

  it('keeps the world map un-zoomable until current location locks in', async () => {
    const { root, mapAdapter, geocodingProvider, mainPage } = setup();
    geocodingProvider.geocodeQueue.push({ lng: -96.77, lat: 33.0 }, null);
    await mainPage.mount();
    expect(mapAdapter.zoomEnabled).toBe(false);

    (root.querySelector('input') as HTMLInputElement).value = '123 Main St';
    root.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flushPromises();
    expect(mapAdapter.zoomEnabled).toBe(true);
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

  it('shows the load-error toast (but still locks in the location and fits the camera) when showNear rejects', async () => {
    const { root, mapAdapter, geocodingProvider, entityProvider, mainPage } = setup();
    entityProvider.showNearShouldFail = true;
    const coordinates = { lng: -96.77, lat: 33.0 };
    geocodingProvider.geocodeQueue.push(coordinates);
    await mainPage.mount();

    (root.querySelector('input') as HTMLInputElement).value = '123 Main St';
    root.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flushPromises();

    expect(shownToast(root)).toBe("Couldn't load restaurants.");
    expect(mapAdapter.fitBoundsCalls).toEqual([expectedLockBounds(coordinates)]);
  });

  it('hides the load-error toast on a later, already-locked search', async () => {
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

    expect(shownToast(root)).toBeNull();
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
      (b) => b.getAttribute('aria-label') === 'Use current location'
    ) as HTMLButtonElement;
    locateButton.click();
    await flushPromises();

    expect((root.querySelector('input') as HTMLInputElement).validationMessage).toBe(
      'Location permission denied. Allow it for this site in your browser settings.'
    );
    expect(root.querySelector('.modal-backdrop')?.classList.contains('hidden')).toBe(true);
  });

  it.each([
    ['on plain http', { isSecureContext: false }, 'Location only works on a secure (https) connection.'],
    ['when locating times out', { geolocation: fakeGeolocation('timeout') }, 'Finding your location timed out. Please try again.'],
    ['when geolocation is unsupported', { geolocation: null }, 'Could not determine your location.']
  ])('explains why locating failed %s', async (_case, overrides, expected) => {
    const { root, mainPage } = setup(overrides);
    await mainPage.mount();

    const locateButton = Array.from(root.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === 'Use current location'
    ) as HTMLButtonElement;
    locateButton.click();
    await flushPromises();

    expect((root.querySelector('input') as HTMLInputElement).validationMessage).toBe(expected);
  });

  it('shows the centered spinner (not status text) while a search runs, and hides it after', async () => {
    const { root, geocodingProvider, mainPage } = setup();
    geocodingProvider.geocodeQueue.push({ lng: -96.77, lat: 33.0 });
    await mainPage.mount();
    const spinner = root.querySelector('.busy-spinner') as HTMLElement;

    (root.querySelector('input') as HTMLInputElement).value = '123 Main St';
    root.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect(spinner.classList.contains('visible')).toBe(true);
    expect(spinner.textContent).toBe('Searching...');
    expect(shownToast(root)).toBeNull();

    await flushPromises();
    expect(spinner.classList.contains('visible')).toBe(false);
  });

  it('shows a native validation bubble when Search is hit with an empty address', async () => {
    const { root, geocodingProvider, mainPage } = setup();
    await mainPage.mount();
    const input = root.querySelector('input') as HTMLInputElement;
    let bubbles = 0;
    input.addEventListener('invalid', () => bubbles++);

    input.value = '   ';
    root.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));

    expect(input.validationMessage).toBe('Please enter an address.');
    expect(bubbles).toBe(1);
    expect(geocodingProvider.geocodeCalls).toEqual([]);
  });

  it('shows "no results" in the bubble, and clears it once the user edits the field', async () => {
    const { root, geocodingProvider, mainPage } = setup();
    geocodingProvider.geocodeQueue.push(null);
    await mainPage.mount();
    const input = root.querySelector('input') as HTMLInputElement;

    input.value = 'nowhere';
    root.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flushPromises();
    expect(input.validationMessage).toBe('No results found for that address.');
    expect(shownToast(root)).toBeNull();

    input.dispatchEvent(new Event('input'));
    expect(input.validationMessage).toBe('');
  });

  it('using current location (the first lock) instantly fits the camera to the search-radius area', async () => {
    const { root, mapAdapter, mainPage } = setup();
    await mainPage.mount();

    const locateButton = Array.from(root.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === 'Use current location'
    ) as HTMLButtonElement;
    locateButton.click();
    await flushPromises();

    expect(mapAdapter.fitBoundsCalls).toEqual([expectedLockBounds({ lng: -96.8, lat: 33.05 })]);
    expect(mapAdapter.flyToCalls).toEqual([]);
  });
});

describe('MainPage search ring following the map', () => {
  const home = { lng: -96.8, lat: 33.05 }; // the default fake geolocation
  const elsewhere = { lng: -96.7, lat: 33.15 }; // ~9 mi away

  afterEach(() => {
    vi.useRealTimers();
  });

  async function setupLocked(overrides: Partial<MainPageDeps> = {}) {
    vi.useFakeTimers();
    const context = setup(overrides);
    await context.mainPage.mount();
    const locateButton = Array.from(context.root.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === 'Use current location'
    ) as HTMLButtonElement;
    locateButton.click();
    await vi.advanceTimersByTimeAsync(0);
    context.entityProvider.showNearCalls.length = 0;
    return context;
  }

  it('does not search when the start-screen world map is dragged', async () => {
    vi.useFakeTimers();
    const { mapAdapter, entityProvider, mainPage } = setup();
    await mainPage.mount();
    mapAdapter.drag(elsewhere);
    await vi.advanceTimersByTimeAsync(1000);
    expect(entityProvider.showNearCalls).toEqual([]);
  });

  it('re-searches around the new map center only once the map has settled', async () => {
    const { mapAdapter, entityProvider } = await setupLocked();
    mapAdapter.drag(elsewhere);
    await vi.advanceTimersByTimeAsync(400);
    expect(entityProvider.showNearCalls).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(entityProvider.showNearCalls).toEqual([{ center: elsewhere, radiusMiles: 5 }]);
  });

  it('a new drag before settling cancels the pending search', async () => {
    const { mapAdapter, entityProvider } = await setupLocked();
    const further = { lng: -96.6, lat: 33.25 };
    mapAdapter.drag(elsewhere);
    await vi.advanceTimersByTimeAsync(300);
    mapAdapter.drag(further);
    await vi.advanceTimersByTimeAsync(500);
    expect(entityProvider.showNearCalls).toEqual([{ center: further, radiusMiles: 5 }]);
  });

  it('ignores a settled move that barely shifts the center', async () => {
    const { mapAdapter, entityProvider } = await setupLocked();
    mapAdapter.drag({ lng: home.lng + 0.0005, lat: home.lat });
    await vi.advanceTimersByTimeAsync(1000);
    expect(entityProvider.showNearCalls).toEqual([]);
  });

  it('still measures distance from current location after the ring moves', async () => {
    const { root, mapAdapter, entityProvider } = await setupLocked();
    mapAdapter.drag(elsewhere);
    await vi.advanceTimersByTimeAsync(500);

    const entityCoordinates = { lng: -96.71, lat: 33.14 };
    entityProvider.trigger?.({ name: 'Somewhere Grill', coordinates: entityCoordinates });
    await vi.advanceTimersByTimeAsync(0);

    const lines = Array.from(root.querySelectorAll('.modal-details p')).map((p) => p.textContent);
    expect(lines).toContain(formatDistanceMiles(haversineDistanceMiles(home, entityCoordinates)));
  });

  it('shows the load-error toast when a settled search fails, and hides it once one succeeds', async () => {
    const { root, mapAdapter, entityProvider } = await setupLocked();

    entityProvider.showNearShouldFail = true;
    mapAdapter.drag(elsewhere);
    await vi.advanceTimersByTimeAsync(500);
    expect(shownToast(root)).toBe("Couldn't load restaurants.");

    entityProvider.showNearShouldFail = false;
    mapAdapter.drag(home);
    await vi.advanceTimersByTimeAsync(500);
    expect(shownToast(root)).toBeNull();
  });

  it("the toast's Retry re-searches around the current ring", async () => {
    const { root, mapAdapter, entityProvider } = await setupLocked();
    entityProvider.showNearShouldFail = true;
    mapAdapter.drag(elsewhere);
    await vi.advanceTimersByTimeAsync(500);

    entityProvider.showNearShouldFail = false;
    (root.querySelector('.toast-action') as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(0);

    expect(entityProvider.showNearCalls[entityProvider.showNearCalls.length - 1]).toEqual({ center: elsewhere, radiusMiles: 5 });
    expect(shownToast(root)).toBeNull();
  });
});
