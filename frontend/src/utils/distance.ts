import type { Coordinates } from '../core/types';

// Great-circle (straight-line) distance: pure math on two already-known
// coordinate pairs - negligible CPU cost and no network round trip, unlike
// driving time, which would require calling an external routing service for
// every entity clicked.
const EARTH_RADIUS_MILES = 3958.8;

/**
 * What: Converts degrees to radians.
 * Why: Math.sin/Math.cos/etc expect radians, but coordinates are in degrees;
 * this is a small shared step inside the Haversine formula.
 * Without it: The conversion would be inlined and repeated at each call site
 * inside haversineDistanceMiles, or (worse) forgotten, producing wrong results.
 * Inputs: degrees - an angle in degrees.
 * Output: The equivalent angle in radians.
 */
function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * What: Computes the great-circle (straight-line, "as the crow flies")
 * distance in miles between two coordinates, via the Haversine formula.
 * Why: Powers the modal's distance line. Chosen deliberately over driving
 * distance/time: it's pure client-side math with no network cost, unlike a
 * routing API call that would be needed for driving time.
 * Without it: The modal would have no way to show how far an entity is from
 * the user's current location.
 * Inputs: a, b - two Coordinates (lat/lng pairs); order doesn't matter, the
 * result is symmetric.
 * Output: The distance between a and b in miles.
 */
export function haversineDistanceMiles(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * sinDLng * sinDLng;
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * What: Formats a distance in miles as a one-decimal "X.X mi away" string.
 * Why: Keeps the exact display format (precision, unit label) in one place
 * rather than repeated wherever a distance is shown.
 * Without it: MainPage would need to format the number itself, risking
 * inconsistent rounding/wording if shown in more than one place later.
 * Inputs: miles - a distance in miles (e.g. from haversineDistanceMiles).
 * Output: A display string, e.g. "1.8 mi away".
 */
export function formatDistanceMiles(miles: number): string {
  return `${miles.toFixed(1)} mi away`;
}
