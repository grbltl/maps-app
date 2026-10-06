import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { MapAdapter } from '../../core/interfaces/MapAdapter';
import type { Coordinates } from '../../core/types';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/bright';

export class MapLibreMapAdapter implements MapAdapter {
  private map: maplibregl.Map | null = null;
  private marker: maplibregl.Marker | null = null;

  mount(container: HTMLElement): Promise<void> {
    const map = new maplibregl.Map({
      container,
      style: STYLE_URL,
      center: [0, 20], // world view: MainPage always starts here regardless of adapter
      zoom: 1,
      attributionControl: false
    });
    this.map = map;

    return new Promise((resolve) => {
      map.on('load', () => resolve());
    });
  }

  flyTo(coordinates: Coordinates, zoom: number): void {
    this.requireMap().flyTo({
      center: [coordinates.lng, coordinates.lat],
      zoom,
      essential: true,
      speed: 0.8, // lower = more cinematic; duration scales with distance
      curve: 1.42, // MapLibre default "swoop" shape (zoom out, pan, zoom in)
      maxDuration: 6000 // cap so far-away destinations don't fly forever
    });
  }

  setMarker(coordinates: Coordinates): void {
    const map = this.requireMap();
    if (!this.marker) {
      this.marker = new maplibregl.Marker({ color: '#007AFF' })
        .setLngLat([coordinates.lng, coordinates.lat])
        .addTo(map);
    } else {
      this.marker.setLngLat([coordinates.lng, coordinates.lat]);
    }
  }

  lockInteraction(): void {
    const map = this.requireMap();
    map.scrollZoom.disable();
    map.dragPan.disable();
    map.touchZoomRotate.disable();
    map.doubleClickZoom.disable();
    map.boxZoom.disable();
    map.keyboard.disable();
  }

  unlockInteraction(): void {
    const map = this.requireMap();
    map.scrollZoom.enable();
    map.dragPan.enable();
    map.touchZoomRotate.enable();
    map.doubleClickZoom.enable();
    map.boxZoom.enable();
    map.keyboard.enable();
  }

  getNativeMap(): unknown {
    return this.requireMap();
  }

  private requireMap(): maplibregl.Map {
    if (!this.map) throw new Error('MapLibreMapAdapter used before mount() resolved');
    return this.map;
  }
}
