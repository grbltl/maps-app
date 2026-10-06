import type { Coordinates } from '../core/types';

/**
 * What: Wraps the browser's callback-based Geolocation.getCurrentPosition in
 * a Promise, configured for network-based (not GPS) positioning.
 * Why: MainPage's async methods (resolveCurrentLocation, etc.) need to
 * `await` a location rather than deal with success/error callbacks directly;
 * accepting the Geolocation instance as a parameter (rather than reading
 * navigator.geolocation internally) lets callers inject a fake one in tests.
 * enableHighAccuracy is deliberately false: network-based positioning (tens
 * of meters of error) is negligible for a one-decimal "X.X mi away" distance
 * line, and this avoids powering up the GPS radio for what's at most one
 * call per page session - a deliberate battery tradeoff.
 * Without it: Callers would have to handle the raw callback API directly
 * (awkward to use with async/await), and/or would default to GPS, needlessly
 * draining battery for a feature that doesn't need meter-level precision.
 * Inputs: geolocation - a Geolocation instance (typically
 * navigator.geolocation, or a fake in tests).
 * Output: A Promise resolving to Coordinates, or rejecting with whatever
 * error the browser reports (denied permission, timeout, unavailable, etc).
 */
export function getCurrentPosition(geolocation: Geolocation): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      (position) => resolve({ lng: position.coords.longitude, lat: position.coords.latitude }),
      reject,
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 }
    );
  });
}
