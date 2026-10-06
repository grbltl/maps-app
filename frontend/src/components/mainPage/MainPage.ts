import './MainPage.css';
import type { MapAdapter } from '../../core/interfaces/MapAdapter';
import type { EntityProvider } from '../../core/interfaces/EntityProvider';
import type { GeocodingProvider } from '../../core/interfaces/GeocodingProvider';
import type { Coordinates, Entity, EntityConfig } from '../../core/types';
import { Modal, type ModalLine } from '../modal/Modal';
import { haversineDistanceMiles, formatDistanceMiles } from '../../utils/distance';
import { getCurrentPosition } from '../../utils/geolocation';

export interface MainPageDeps {
  mapAdapter: MapAdapter;
  entityProvider: EntityProvider;
  geocodingProvider: GeocodingProvider;
  entityConfig: EntityConfig;
  /** Defaults to navigator.geolocation; injectable so tests can fake it. */
  geolocation?: Geolocation | null;
}

// Entities are split across minzoom tiers in the current MapLibre/OpenFreeMap
// style (poi_r1 from z15, poi_r7 - the bulk of ordinary POIs - only from z16).
// That's a style rendering cutoff, not a network/tile cost, so landing one
// tier higher doesn't cost any load time - it just shows what was already
// there, without requiring an extra manual zoom step.
const DEFAULT_ZOOM = 16;

/**
 * What: The second "plug" - owns the address-search/locate controls, the map
 * container, and the entity-info modal, and wires them to whatever
 * MapAdapter/EntityProvider/GeocodingProvider are injected.
 * Why: This is where the app's actual behavior (search, locate, show entity
 * details) lives, written entirely against the three provider interfaces so
 * it works unchanged regardless of which concrete adapters the composition
 * root (main.ts) plugs in.
 * Without it: There would be no orchestration tying the map, controls, and
 * modal together - each adapter/component would exist but nothing would
 * connect a click or search to a visible result.
 * Inputs: n/a (class declaration - see each member below).
 * Output: n/a (class declaration - see each member below).
 */
export class MainPage {
  private readonly mapContainer: HTMLDivElement;
  private readonly statusEl: HTMLDivElement;
  private readonly modal: Modal;

  private currentLocation: Coordinates | null = null;
  private modalRequestId = 0;

  /**
   * What: Builds the controls (address form, locate button, status line),
   * the map container, and the Modal, and wires their event listeners.
   * Why: MainPage needs all its DOM and child components to exist and be
   * connected before mount() can bring the map online.
   * Without it: There would be no UI for a user to interact with, and no
   * wiring between form submission/button clicks and MainPage's handlers.
   * Inputs: root - the element to mount all of MainPage's DOM into; deps -
   * the injected adapters/config (and optional geolocation override) this
   * instance will use.
   * Output: n/a (constructor) - MainPage's DOM exists afterward, map not yet mounted.
   */
  constructor(root: HTMLElement, private readonly deps: MainPageDeps) {
    const controls = document.createElement('div');
    controls.className = 'controls';

    const form = document.createElement('form');
    form.className = 'address-form';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Enter a full address';
    input.autocomplete = 'off';

    const searchButton = document.createElement('button');
    searchButton.type = 'submit';
    searchButton.textContent = 'Search';

    form.append(input, searchButton);

    const locateButton = document.createElement('button');
    locateButton.type = 'button';
    locateButton.textContent = 'Use current location';

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'status';

    controls.append(form, locateButton, this.statusEl);

    this.mapContainer = document.createElement('div');
    this.mapContainer.className = 'map-container';

    const modalRoot = document.createElement('div');

    root.append(controls, this.mapContainer, modalRoot);

    this.modal = new Modal(modalRoot, {
      onOpen: () => this.deps.mapAdapter.lockInteraction(),
      onClose: () => this.deps.mapAdapter.unlockInteraction()
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const address = input.value.trim();
      if (address) void this.handleSearch(address);
    });

    locateButton.addEventListener('click', () => void this.handleLocate());
  }

  /**
   * What: Mounts the map adapter into the map container and activates entity
   * discovery for the configured category.
   * Why: Separated from the constructor so MainPage's DOM/wiring can exist
   * synchronously while the actual map (an async operation) comes online
   * afterward; the composition root awaits this before the app is "ready".
   * Without it: The map would never actually render, and entity clicks would
   * never be wired up.
   * Inputs: None (uses this.deps, set in the constructor).
   * Output: A Promise that resolves once the map is mounted and entity
   * discovery is active.
   */
  async mount(): Promise<void> {
    await this.deps.mapAdapter.mount(this.mapContainer);
    this.deps.entityProvider.activate(this.deps.entityConfig, (entity) => this.showEntityModal(entity));
  }

  /**
   * What: Sets the status line's text (search/locate progress or errors).
   * Why: Gives the user feedback for the address form and locate button
   * without needing a separate notification system.
   * Without it: Searching or locating would appear to do nothing while in
   * progress, and failures would be silent.
   * Inputs: message - the text to show; pass '' to clear it.
   * Output: None (void) - updates the rendered status line as a side effect.
   */
  private setStatus(message: string): void {
    this.statusEl.textContent = message;
  }

  /**
   * What: Geocodes a typed address, flies the map to it, and locks it in as
   * "current location" if nothing has claimed that yet.
   * Why: This is what the address search box actually does, and - per
   * product decision - a typed address is an equally valid way to establish
   * "current location" as the browser's geolocation, with no permission
   * prompt required.
   * Without it: The search box would have no effect, and there would be no
   * geolocation-free way to set "current location".
   * Inputs: address - the trimmed, non-empty address string from the input.
   * Output: A Promise that resolves once the flow completes (success,
   * no-results, or error) - all outcomes are reflected via setStatus/map
   * calls rather than a return value.
   */
  private async handleSearch(address: string): Promise<void> {
    this.setStatus('Searching...');
    try {
      const coordinates = await this.deps.geocodingProvider.geocode(address);
      if (!coordinates) {
        this.setStatus('No results found for that address.');
        return;
      }
      this.setStatus('');
      // First location set this session (typed address or geolocation) wins
      // and is locked in until reload - later searches don't overwrite it.
      if (!this.currentLocation) this.currentLocation = coordinates;
      this.deps.mapAdapter.setMarker(coordinates);
      this.deps.mapAdapter.flyTo(coordinates, DEFAULT_ZOOM);
    } catch {
      this.setStatus('Could not look up that address. Please try again.');
    }
  }

  /**
   * What: Resolves "current location" (prompting the browser if needed) and
   * flies the map to it.
   * Why: This is what the "Use current location" button actually does.
   * Without it: The button would have no effect.
   * Inputs: None (uses this.currentLocation/this.deps internally via
   * resolveCurrentLocation()).
   * Output: A Promise that resolves once the flow completes (success or
   * denied/unavailable) - reflected via setStatus/map calls rather than a
   * return value.
   */
  private async handleLocate(): Promise<void> {
    this.setStatus('Locating...');
    try {
      const coordinates = await this.resolveCurrentLocation();
      this.setStatus('');
      this.deps.mapAdapter.setMarker(coordinates);
      this.deps.mapAdapter.flyTo(coordinates, DEFAULT_ZOOM);
    } catch {
      this.setStatus('Location access denied or unavailable.');
    }
  }

  /**
   * What: Returns the injected geolocation override if one was given (even
   * if explicitly null, e.g. to simulate an unsupported browser), falling
   * back to the real navigator.geolocation otherwise.
   * Why: Centralizes which geolocation source is "the" source so the "do we
   * have a location source at all" check (in showEntityModal) and the actual
   * fetch (in resolveCurrentLocation) can never disagree. A prior version of
   * this code checked navigator.geolocation directly in one place and the
   * injected override in another, which silently skipped distance
   * calculation whenever a geolocation source was provided via dependency
   * injection (including in every unit test) - a real bug, not just a test
   * artifact.
   * Without it: Tests (and any future non-browser environment) would have no
   * reliable way to fake geolocation, since some code path would always fall
   * through to the real, absent navigator.geolocation.
   * Inputs: None (reads this.deps.geolocation).
   * Output: A Geolocation instance to use, or null if none is available.
   */
  private getGeolocation(): Geolocation | null {
    return this.deps.geolocation === undefined ? navigator.geolocation : this.deps.geolocation;
  }

  /**
   * What: Returns the cached "current location" if the session already has
   * one; otherwise prompts the browser for it (only ever once per session)
   * and caches the result.
   * Why: Both handleLocate() and showEntityModal()'s distance calculation
   * need "current location" without duplicating the cache-or-fetch logic or
   * triggering a second permission prompt.
   * Without it: Every caller would need its own caching logic, risking the
   * browser being asked for permission more than once per session - counter
   * to the "locked once per session" product decision.
   * Inputs: None (uses this.currentLocation/this.getGeolocation()).
   * Output: A Promise resolving to Coordinates; caches the result in
   * this.currentLocation as a side effect. Rejects if there's no geolocation
   * source available or the user denies/the request fails.
   */
  private async resolveCurrentLocation(): Promise<Coordinates> {
    if (this.currentLocation) return this.currentLocation;
    const geolocation = this.getGeolocation();
    if (!geolocation) throw new Error('Geolocation unsupported');
    const coordinates = await getCurrentPosition(geolocation);
    this.currentLocation = coordinates;
    return coordinates;
  }

  /**
   * What: Opens the entity-info modal for a clicked entity and progressively
   * fills in its distance, address, and phone as each resolves.
   * Why: This is what actually happens when a user clicks an entity on the
   * map - and address/phone (a network call) and distance (location
   * resolution, possibly also async) load independently and at different
   * speeds, so each should render as soon as it's ready rather than one
   * blocking the other.
   * Without it: Clicking an entity would do nothing, or the modal would have
   * to wait for the slower of two unrelated lookups before showing anything.
   * Inputs: entity - the clicked Entity (name + coordinates) reported by EntityProvider.
   * Output: None (void) - opens/updates the modal as a side effect.
   * A requestId guards against a late-resolving lookup from a previous click
   * overwriting a newer one if the user clicks another entity before the
   * first finishes loading.
   */
  private showEntityModal(entity: Entity): void {
    const requestId = ++this.modalRequestId;
    const hasLocationSource: boolean = Boolean(this.currentLocation) || Boolean(this.getGeolocation());

    const state = {
      addressLoading: true,
      addressLines: null as string[] | null,
      phone: null as string | null,
      distanceLoading: hasLocationSource,
      distanceLine: null as string | null
    };

    /**
     * What: Re-renders the modal's body lines from the current state.
     * Why: address/phone and distance update independently as their
     * respective lookups resolve; re-deriving the full line list from state
     * each time keeps rendering consistent instead of hand-patching the DOM
     * per update.
     * Without it: Each async resolution would need its own bespoke DOM
     * update, risking lines appearing in the wrong order or going stale.
     * Inputs: None (closes over `state`).
     * Output: None (void) - calls this.modal.setLines() as a side effect.
     */
    const render = (): void => {
      const lines: ModalLine[] = [];
      if (state.distanceLoading) lines.push('Finding distance...');
      else if (state.distanceLine) lines.push(state.distanceLine);

      if (state.addressLoading) {
        lines.push('Loading...');
      } else {
        if (state.addressLines) lines.push(state.addressLines);
        if (state.phone) lines.push(state.phone);
      }
      this.modal.setLines(lines);
    };

    this.modal.setTitle(entity.name);
    render();
    this.modal.open();

    this.deps.geocodingProvider
      .getEntityDetails(entity.coordinates)
      .then((details) => {
        if (requestId !== this.modalRequestId) return; // a newer click superseded this one
        state.addressLoading = false;
        state.addressLines = details.address;
        state.phone = details.phone;
        render();
      })
      .catch(() => {
        if (requestId !== this.modalRequestId) return;
        state.addressLoading = false;
        state.addressLines = ['Address unavailable.'];
        render();
      });

    if (hasLocationSource) {
      this.resolveCurrentLocation()
        .then((location) => {
          if (requestId !== this.modalRequestId) return;
          state.distanceLoading = false;
          state.distanceLine = formatDistanceMiles(haversineDistanceMiles(location, entity.coordinates));
          render();
        })
        .catch(() => {
          if (requestId !== this.modalRequestId) return;
          state.distanceLoading = false;
          state.distanceLine = null; // location denied/unavailable - omit the line
          render();
        });
    }
  }
}
