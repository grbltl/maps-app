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
 * The second "plug": owns the address-search/locate controls, the map
 * container, and the entity-info modal, and wires them to whatever
 * MapAdapter/EntityProvider/GeocodingProvider are injected. Always starts on
 * a world map (MapAdapter's own default) regardless of which adapter is used.
 */
export class MainPage {
  private readonly mapContainer: HTMLDivElement;
  private readonly statusEl: HTMLDivElement;
  private readonly modal: Modal;

  private currentLocation: Coordinates | null = null;
  private modalRequestId = 0;

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

  async mount(): Promise<void> {
    await this.deps.mapAdapter.mount(this.mapContainer);
    this.deps.entityProvider.activate(this.deps.entityConfig, (entity) => this.showEntityModal(entity));
  }

  private setStatus(message: string): void {
    this.statusEl.textContent = message;
  }

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

  /** The injected geolocation override if one was given (even if explicitly
   * null, e.g. to simulate an unsupported browser), falling back to the real
   * navigator.geolocation otherwise. Centralized so the "do we have a
   * location source at all" check and the actual fetch never disagree. */
  private getGeolocation(): Geolocation | null {
    return this.deps.geolocation === undefined ? navigator.geolocation : this.deps.geolocation;
  }

  /** Returns the cached location if the session already has one; otherwise
   * prompts the browser for it (only ever once per session) and caches it. */
  private async resolveCurrentLocation(): Promise<Coordinates> {
    if (this.currentLocation) return this.currentLocation;
    const geolocation = this.getGeolocation();
    if (!geolocation) throw new Error('Geolocation unsupported');
    const coordinates = await getCurrentPosition(geolocation);
    this.currentLocation = coordinates;
    return coordinates;
  }

  // Address/phone (geocoding) and distance (location) resolve independently
  // and at different speeds, so each renders as soon as it's ready rather
  // than waiting on the other.
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
