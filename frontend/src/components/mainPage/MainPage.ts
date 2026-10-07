import './MainPage.css';
import type { MapOutlet } from '../../core/interfaces/MapOutlet';
import type { EntityProviderOutlet } from '../../core/interfaces/EntityProviderOutlet';
import type { GeocodingOutlet } from '../../core/interfaces/GeocodingOutlet';
import type { Coordinates, Entity, EntityConfig } from '../../core/types';
import { Modal, type ModalLine } from '../modal/Modal';
import { Toast } from '../toast/Toast';
import { haversineDistanceMiles, formatDistanceMiles } from '../../utils/distance';
import { activeDeals } from '../../utils/deals';
import { getCurrentPosition } from '../../utils/geolocation';
import { boundsFromCoordinates, buildCirclePolygonCoordinates } from '../../utils/geoCircle';

export interface MainPageDeps {
  mapAdapter: MapOutlet;
  entityProvider: EntityProviderOutlet;
  geocodingProvider: GeocodingOutlet;
  entityConfig: EntityConfig;
  /** Defaults to navigator.geolocation; injectable so tests can fake it. */
  geolocation?: Geolocation | null;
  /** Defaults to window.isSecureContext; injectable so tests can fake it. */
  isSecureContext?: boolean;
}

// A reasonable close-in zoom for flying to an address the user searches
// *after* current location is already locked in (just navigation - the
// locking search itself instantly fits the whole search-radius area instead,
// see setCurrentLocationIfUnset).
const DEFAULT_ZOOM = 16;

// How far out EntityProviderOutlet.showNear() searches around the search
// center - entities farther than this are filtered out in the browser.
const ENTITY_SEARCH_RADIUS_MILES = 5;

// After current location locks in, the search ring follows the map: once the
// camera has stopped moving for this long, entities are re-searched around
// the new map center. Users drag around freely and only pay for a search
// once they settle.
const SETTLE_DELAY_MS = 500;

// A settled move shorter than this from the last search center doesn't
// re-search (e.g. a zoom gesture that barely shifts the center, or the
// lock's own fitBounds landing a few meters off the exact location).
const MIN_RESEARCH_MOVE_MILES = 0.1;

// Magnifier for the icon-only Search button. Static markup, so innerHTML is
// safe here.
const SEARCH_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>';

// "Locate me" crosshair for the icon-only locate button. Static markup, so
// innerHTML is safe here.
const LOCATE_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5" ' +
  'fill="currentColor" stroke="none"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';

// Breathing room between the controls panel and the top of the world map.
const CONTROLS_GAP_PX = 8;

const ENTITY_LOAD_ERROR = "Couldn't load restaurants.";

// Browsers only hand out location to secure pages (https, or localhost).
class InsecureContextError extends Error {}

/**
 * What: Turns a failed "Use current location" attempt into a status message
 * that says what actually went wrong.
 * Why: The causes need different fixes from the user - open the https
 * address, allow location in settings, or just retry - so one generic
 * "denied or unavailable" message leaves them stuck.
 * Without it: Every failure would look the same, including the common
 * "opened over plain http" case where the browser never even prompts.
 * Inputs: error - whatever resolveCurrentLocation() rejected with (an
 * InsecureContextError, a GeolocationPositionError-shaped object, or other).
 * Output: The status-line text.
 */
function locateErrorMessage(error: unknown): string {
  if (error instanceof InsecureContextError) {
    return 'Location only works on a secure (https) connection.';
  }
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 1) return 'Location permission denied. Allow it for this site in your browser settings.';
  if (code === 3) return 'Finding your location timed out. Please try again.';
  return 'Could not determine your location.';
}

/**
 * What: The second "plug" - owns the address-search/locate controls, the map
 * container, and the entity-info modal, and wires them to whatever
 * MapOutlet/EntityProviderOutlet/GeocodingOutlet are injected.
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
  private readonly controls: HTMLDivElement;
  private readonly addressInput: HTMLInputElement;
  private readonly spinner: HTMLDivElement;
  private readonly spinnerLabel: HTMLSpanElement;
  // How many search/locate flows are in progress; the spinner shows while > 0.
  private busyCount = 0;
  private readonly modal: Modal;
  private readonly toast: Toast;

  private currentLocation: Coordinates | null = null;
  private modalRequestId = 0;
  // Where the search ring is currently centered: current location at first,
  // then wherever the map settled. Null until current location locks in -
  // the start-screen world map never searches.
  private lastSearchCenter: Coordinates | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;

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
    this.controls = controls;

    const form = document.createElement('form');
    form.className = 'address-form';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Enter a full address';
    input.autocomplete = 'off';
    this.addressInput = input;

    const searchButton = document.createElement('button');
    searchButton.type = 'submit';
    searchButton.className = 'icon-button';
    searchButton.setAttribute('aria-label', 'Search');
    searchButton.title = 'Search';
    searchButton.innerHTML = SEARCH_ICON_SVG;

    form.append(input, searchButton);

    const locateButton = document.createElement('button');
    locateButton.type = 'button';
    // Icon-only so locate + address field + Search fit one row on a phone;
    // the label stays available to screen readers and as a tooltip.
    locateButton.className = 'icon-button';
    locateButton.setAttribute('aria-label', 'Use current location');
    locateButton.title = 'Use current location';
    locateButton.innerHTML = LOCATE_ICON_SVG;

    controls.append(locateButton, form);

    this.mapContainer = document.createElement('div');
    this.mapContainer.className = 'map-container';

    // Centered progress spinner for search/locate. Purely visual: it never
    // blocks touches, and the label is for screen readers only.
    this.spinner = document.createElement('div');
    this.spinner.className = 'busy-spinner';
    this.spinner.setAttribute('role', 'status');
    this.spinner.setAttribute('aria-live', 'polite');
    const spinnerRing = document.createElement('div');
    spinnerRing.className = 'busy-spinner-ring';
    this.spinnerLabel = document.createElement('span');
    this.spinnerLabel.className = 'visually-hidden';
    this.spinner.append(spinnerRing, this.spinnerLabel);

    const modalRoot = document.createElement('div');

    root.append(controls, this.mapContainer, this.spinner, modalRoot);

    this.toast = new Toast(root);

    this.modal = new Modal(modalRoot, {
      onOpen: () => this.deps.mapAdapter.lockInteraction(),
      onClose: () => this.deps.mapAdapter.unlockInteraction()
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const address = input.value.trim();
      if (address) void this.handleSearch(address);
      else this.showFieldError('Please enter an address.');
    });

    // A field error lasts until the user edits or leaves the field. Leaving
    // matters: tapping Search blurs the field first, so a stale error (e.g.
    // a location failure) never blocks the next submit.
    const clearFieldError = (): void => input.setCustomValidity('');
    input.addEventListener('input', clearFieldError);
    input.addEventListener('blur', clearFieldError);

    locateButton.addEventListener('click', () => void this.handleLocate());

    // The app frame never zooms - only the map does. The viewport meta tag
    // (index.html) handles most browsers, but iOS Safari ignores
    // user-scalable=no and still pinch-zooms the whole page; cancelling its
    // proprietary gesture events stops that. MapLibre's own pinch-zoom is
    // built on touch events, so it's unaffected.
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      document.addEventListener(type, (event) => event.preventDefault(), { passive: false });
    }
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
    // Measured before the map exists so its very first frame already fits
    // the world below the controls, then kept current as the panel resizes
    // (buttons wrapping on rotation, a long status message).
    this.deps.mapAdapter.setTopInset(this.controlsBottomPx());
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.deps.mapAdapter.setTopInset(this.controlsBottomPx())).observe(this.controls);
    }
    await this.deps.mapAdapter.mount(this.mapContainer);
    // Start screen: the world map can be dragged sideways but not zoomed
    // until current location locks in (see setCurrentLocationIfUnset).
    this.deps.mapAdapter.setZoomEnabled(false);
    this.deps.mapAdapter.onMoveStart(() => this.cancelSettledSearch());
    this.deps.mapAdapter.onMoveEnd((center) => this.scheduleSettledSearch(center));
    this.deps.entityProvider.activate(this.deps.entityConfig, (entity) => this.showEntityModal(entity));
  }

  /**
   * What: How far down the map container the controls panel reaches,
   * plus a small gap.
   * Why: The map keeps that strip clear (MapOutlet.setTopInset) so the whole
   * world - and later framing - shows below the panel, not under it.
   * Without it: The top of the world map would be hidden by the panel.
   * Inputs: None (reads the rendered layout).
   * Output: Pixels from the map container's top edge; 0 if not laid out.
   */
  private controlsBottomPx(): number {
    const panel = this.controls.getBoundingClientRect();
    if (panel.height === 0) return 0;
    const map = this.mapContainer.getBoundingClientRect();
    return Math.max(0, Math.ceil(panel.bottom - map.top + CONTROLS_GAP_PX));
  }

  /**
   * What: Shows a message in the browser's native validation bubble on the
   * address field.
   * Why: Search and locate failures read as a native prompt on the field
   * rather than a line of red text. Location errors anchor here too - a
   * button can't show the bubble (type="button" is barred from validation),
   * and typing an address is the fallback when location fails anyway.
   * Without it: Errors would only be shown on the status line.
   * Inputs: message - the text for the bubble.
   * Output: None (void). Focuses the field (the browser does this to show
   * the bubble); cleared again by clearFieldError on input/blur.
   */
  private showFieldError(message: string): void {
    this.addressInput.setCustomValidity(message);
    this.addressInput.reportValidity();
  }

  /**
   * What: Shows the centered spinner (or keeps it showing) for one more
   * in-progress search/locate flow.
   * Why: Tells the user something is happening without a "Searching..."
   * line in the controls. Counted, so overlapping flows (a locate while a
   * search is still running) keep it up until the last one ends.
   * Without it: A search would look like nothing happened until the map moved.
   * Inputs: label - what screen readers announce (e.g. "Searching...").
   * Output: None (void). The CSS fades it in only after a short delay, so
   * instant results don't flash it.
   */
  private beginBusy(label: string): void {
    this.busyCount++;
    this.spinnerLabel.textContent = label;
    this.spinner.classList.add('visible');
  }

  /**
   * What: Ends one in-progress flow started with beginBusy(), hiding the
   * spinner once none are left.
   * Why: See beginBusy().
   * Without it: The spinner would never go away.
   * Inputs: None.
   * Output: None (void).
   */
  private endBusy(): void {
    this.busyCount = Math.max(0, this.busyCount - 1);
    if (this.busyCount > 0) return;
    this.spinner.classList.remove('visible');
    this.spinnerLabel.textContent = '';
  }

  /**
   * What: Shows the "couldn't load restaurants" toast with a Retry button.
   * Why: A failed entity search isn't about anything the user typed, so it
   * gets a non-blocking toast rather than the address field's bubble.
   * Without it: A failed load would just leave the ring empty, unexplained.
   * Inputs: None.
   * Output: None (void).
   */
  private showLoadError(): void {
    this.toast.show(ENTITY_LOAD_ERROR, { label: 'Retry', onClick: () => void this.retryEntitySearch() });
  }

  /**
   * What: Re-runs the entity search around the current ring, with the spinner.
   * Why: The toast's Retry - so a failed load never needs a page reload.
   * Without it: The only way to retry would be moving the map.
   * Inputs: None (uses this.lastSearchCenter).
   * Output: A Promise that resolves once the retry settles (failure shows
   * the toast again, via searchAround).
   */
  private async retryEntitySearch(): Promise<void> {
    if (!this.lastSearchCenter) return;
    this.beginBusy('Loading restaurants...');
    try {
      await this.searchAround(this.lastSearchCenter);
    } finally {
      this.endBusy();
    }
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
   * no-results, or error) - outcomes are reflected via the field bubble,
   * toast, and map rather than a return value.
   */
  private async handleSearch(address: string): Promise<void> {
    this.toast.hide();
    this.beginBusy('Searching...');
    try {
      const coordinates = await this.deps.geocodingProvider.geocode(address);
      if (!coordinates) {
        this.showFieldError('No results found for that address.');
        return;
      }
      this.deps.mapAdapter.setMarker(coordinates);

      // First location set this session (typed address or geolocation) wins
      // and is locked in until reload - later searches don't overwrite it.
      // The locking search itself instantly fits the whole search-radius
      // area (see setCurrentLocationIfUnset) instead of flying to a point, so
      // flyTo only runs for subsequent searches, which are just "look at this
      // other place" navigation, unrelated to the locked distance anchor.
      const isFirstLock = !this.currentLocation;
      await this.setCurrentLocationIfUnset(coordinates);
      if (!isFirstLock) this.deps.mapAdapter.flyTo(coordinates, DEFAULT_ZOOM);
    } catch {
      this.showFieldError('Could not look up that address. Please try again.');
    } finally {
      this.endBusy();
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
   * denied/unavailable) - reflected via the field bubble, toast, and map
   * rather than a return value.
   */
  private async handleLocate(): Promise<void> {
    this.toast.hide();
    this.beginBusy('Locating...');
    try {
      // Captured before resolving: see handleSearch for why only a
      // subsequent (already-locked) locate re-use should fly to a point.
      const isFirstLock = !this.currentLocation;
      const coordinates = await this.resolveCurrentLocation();
      this.deps.mapAdapter.setMarker(coordinates);
      if (!isFirstLock) this.deps.mapAdapter.flyTo(coordinates, DEFAULT_ZOOM);
    } catch (error) {
      this.showFieldError(locateErrorMessage(error));
    } finally {
      this.endBusy();
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
    // Checked up front: on plain http, Safari fails with a bare "permission
    // denied" without ever prompting, which would point the user at the
    // wrong fix. Only an explicit false counts (jsdom leaves it undefined).
    const secure = this.deps.isSecureContext ?? window.isSecureContext;
    if (secure === false) throw new InsecureContextError();
    const coordinates = await getCurrentPosition(geolocation);
    await this.setCurrentLocationIfUnset(coordinates);
    return coordinates;
  }

  /**
   * What: Locks in "current location" the first time it's called in a
   * session, instantly frames the camera to fit the whole search-radius
   * area, and triggers EntityProviderOutlet.showNear() for it.
   * Why: Centralizes the "only the first-ever resolved location wins" rule
   * (shared by handleSearch's typed-address path and
   * resolveCurrentLocation's geolocation path) in one place, and is the one
   * spot that knows when a center point has newly become available to
   * search around. The camera frame is computed and applied *before*
   * awaiting showNear so "instantly" doesn't end up waiting on the network -
   * the user sees the search area the moment it's known, independent of how
   * long the entity data source takes to respond.
   * Without it: The "locked once" logic would need duplicating at both call
   * sites, there would be no single moment to trigger a radius search for
   * providers that need one, and the camera would have no area-sized frame
   * to snap to - only flyTo's point+zoom model.
   * Inputs: coordinates - the newly-resolved location; ignored if a location
   * was already locked in.
   * Output: A Promise that resolves once any showNear() call this triggers
   * settles. Never rejects: a showNear() failure shows the load-error toast
   * (see searchAround) - the location/map flow that called this has already
   * succeeded independently of whether nearby entities loaded.
   */
  private async setCurrentLocationIfUnset(coordinates: Coordinates): Promise<void> {
    if (this.currentLocation) return;
    this.currentLocation = coordinates;
    // Set before fitBounds: its own moveend then sees ~no movement and
    // doesn't schedule a duplicate search.
    this.lastSearchCenter = coordinates;

    const ring = buildCirclePolygonCoordinates(coordinates, ENTITY_SEARCH_RADIUS_MILES);
    this.deps.mapAdapter.fitBounds(boundsFromCoordinates(ring));
    this.deps.mapAdapter.setZoomEnabled(true);

    await this.searchAround(coordinates);
  }

  /**
   * What: Cancels a settled-map search that hasn't fired yet.
   * Why: Called when the camera starts moving again - the user hasn't
   * settled after all, so searching the spot they're leaving is wasted work.
   * Without it: A search could fire mid-drag.
   * Inputs: None.
   * Output: None (void).
   */
  private cancelSettledSearch(): void {
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.settleTimer = null;
  }

  /**
   * What: Schedules a search around the new map center for when the map has
   * been still for SETTLE_DELAY_MS.
   * Why: Moves the search ring to wherever the user ends up looking, while
   * keeping searches rare - one per settled position, not one per frame.
   * Distance in the modal is unaffected: it's always from currentLocation.
   * Without it: The ring would stay where current location first locked in.
   * Inputs: center - the map center the camera stopped at.
   * Output: None (void). Does nothing before current location locks in, or
   * if the map barely moved from the last search center.
   */
  private scheduleSettledSearch(center: Coordinates): void {
    this.cancelSettledSearch();
    if (!this.lastSearchCenter) return;
    if (haversineDistanceMiles(center, this.lastSearchCenter) < MIN_RESEARCH_MOVE_MILES) return;
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      void this.searchAround(center);
    }, SETTLE_DELAY_MS);
  }

  /**
   * What: Moves the search ring to center and shows the entities inside it.
   * Why: The one place every entity search runs through - the lock-time
   * search, settled-map searches, and the toast's Retry.
   * Without it: Each of those would repeat the error handling.
   * Inputs: center - the new search center.
   * Output: A Promise that resolves once the search settles. Never rejects:
   * failure shows the load-error toast; success hides any such toast.
   */
  private async searchAround(center: Coordinates): Promise<void> {
    this.lastSearchCenter = center;
    try {
      await this.deps.entityProvider.showNear?.(center, ENTITY_SEARCH_RADIUS_MILES);
      this.toast.hide();
    } catch (error) {
      console.warn('Could not load nearby entities:', error);
      this.showLoadError();
    }
  }

  /**
   * What: Opens the entity-info modal for a clicked entity, showing whatever
   * details its data source provided, and fills in the distance once
   * "current location" resolves.
   * Why: This is what actually happens when a user clicks an entity on the
   * map. All details come with the entity itself (from our own data
   * source), so only the distance - which may need the browser's location -
   * loads asynchronously.
   * Without it: Clicking an entity would do nothing.
   * Inputs: entity - the clicked Entity reported by EntityProviderOutlet.
   * Output: None (void) - opens/updates the modal as a side effect.
   * A requestId guards against a late-resolving location from a previous
   * click overwriting a newer one if the user clicks another entity first.
   */
  private showEntityModal(entity: Entity): void {
    const requestId = ++this.modalRequestId;
    const hasLocationSource: boolean = Boolean(this.currentLocation) || Boolean(this.getGeolocation());
    const details = entity.details ?? {};
    const deals = activeDeals(details.deals, new Date());

    const state = {
      distanceLoading: hasLocationSource,
      distanceLine: null as string | null
    };

    /**
     * What: Re-renders the modal's body lines from the entity's details and
     * the current distance state.
     * Why: The distance resolves after the modal opens; re-deriving the full
     * line list each time keeps the order consistent instead of
     * hand-patching the DOM.
     * Without it: The distance update would need its own bespoke DOM edit,
     * risking lines appearing in the wrong order.
     * Inputs: None (closes over `state`, `details`, `deals`).
     * Output: None (void) - calls this.modal.setLines() as a side effect.
     * Fields the entity doesn't have are simply left out.
     */
    const render = (): void => {
      const lines: ModalLine[] = [];
      if (state.distanceLoading) lines.push('Finding distance...');
      else if (state.distanceLine) lines.push(state.distanceLine);

      if (details.cuisine) lines.push(details.cuisine);
      if (deals.length > 0) lines.push(["Today's deals:", ...deals.map((deal) => `• ${deal.description}`)]);
      if (details.address && details.address.length > 0) lines.push(details.address);
      if (details.phone) lines.push(details.phone);
      if (details.hours) lines.push(details.hours);
      if (details.website) {
        // Spreadsheet entries often omit the scheme ("example.com").
        const href = /^[a-z][a-z0-9+.-]*:/i.test(details.website) ? details.website : `https://${details.website}`;
        lines.push({ text: details.website, href });
      }
      this.modal.setLines(lines);
    };

    this.modal.setTitle(entity.name);
    render();
    this.modal.open();

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
