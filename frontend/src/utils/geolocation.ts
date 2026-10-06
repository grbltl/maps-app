import type { Coordinates } from '../core/types';

export function getCurrentPosition(geolocation: Geolocation): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      (position) => resolve({ lng: position.coords.longitude, lat: position.coords.latitude }),
      reject,
      // Network-based positioning (Wi-Fi/cell) instead of GPS: tens of meters of
      // error is negligible for a "X.X mi away" distance line, and this avoids
      // powering up the GPS radio for what's at most one call per page session.
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 }
    );
  });
}
