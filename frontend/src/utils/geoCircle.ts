import type { BoundingBox, Coordinates } from '../core/types';
import { EARTH_RADIUS_MILES, toDegrees, toRadians } from './distance';

const DEFAULT_CIRCLE_POINTS = 64;

/**
 * What: Computes points forming a closed geodesic circle ring around a
 * center point at a given radius, using the standard "destination point
 * given distance and bearing" spherical-navigation formula.
 * Why: Powers both the visual search-radius ring and the fitBounds camera
 * target. Uses the same great-circle math as haversineDistanceMiles (rather
 * than a naive flat lat/lng offset) so the circle stays accurate away from
 * the equator, where a degree of longitude covers less real distance than a
 * degree of latitude.
 * Without it: There'd be no way to draw an accurate radius boundary, and
 * fitBounds would have no area to compute its target from.
 * Inputs: center - the circle's center; radiusMiles - the circle's radius;
 * points - how many vertices to generate (more = smoother circle; default 64
 * is plenty smooth for a 5-mile radius at any reasonable screen zoom).
 * Output: An array of [lng, lat] pairs forming a closed ring (first and last
 * points are identical, satisfying the GeoJSON linear-ring requirement).
 */
export function buildCirclePolygonCoordinates(
  center: Coordinates,
  radiusMiles: number,
  points: number = DEFAULT_CIRCLE_POINTS
): Array<[number, number]> {
  const angularDistance = radiusMiles / EARTH_RADIUS_MILES;
  const lat1 = toRadians(center.lat);
  const lng1 = toRadians(center.lng);

  const coordinates: Array<[number, number]> = [];
  for (let i = 0; i <= points; i++) {
    const bearing = (i / points) * 2 * Math.PI;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
    );
    const lng2 =
      lng1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
        Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
      );
    coordinates.push([toDegrees(lng2), toDegrees(lat2)]);
  }
  return coordinates;
}

/**
 * What: Builds a GeoJSON Polygon Feature for a geodesic circle.
 * Why: This is the exact shape MapEntityConnector draws as the visual
 * search-radius ring layer.
 * Without it: Callers that need an actual GeoJSON Feature (not just raw
 * coordinates) would need to wrap buildCirclePolygonCoordinates's output
 * themselves.
 * Inputs: center - the circle's center; radiusMiles - the circle's radius.
 * Output: A GeoJSON Feature whose geometry is a single-ring Polygon.
 */
export function buildCirclePolygonFeature(center: Coordinates, radiusMiles: number): GeoJSON.Feature<GeoJSON.Polygon> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [buildCirclePolygonCoordinates(center, radiusMiles)] }
  };
}

/**
 * What: Computes the smallest axis-aligned bounding box enclosing a set of
 * [lng, lat] coordinates.
 * Why: This is what MainPage passes to MapOutlet.fitBounds() to instantly
 * frame the full search-radius circle the moment "current location" locks in.
 * Without it: There'd be no way to turn "a circle's worth of points" into the
 * west/south/east/north box fitBounds actually needs.
 * Inputs: coordinates - any non-empty array of [lng, lat] pairs (typically
 * from buildCirclePolygonCoordinates).
 * Output: A BoundingBox tightly enclosing every input point.
 */
export function boundsFromCoordinates(coordinates: Array<[number, number]>): BoundingBox {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  for (const [lng, lat] of coordinates) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }

  return { west, south, east, north };
}
