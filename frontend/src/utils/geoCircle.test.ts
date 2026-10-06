import { describe, expect, it } from 'vitest';
import { boundsFromCoordinates, buildCirclePolygonCoordinates, buildCirclePolygonFeature } from './geoCircle';
import { haversineDistanceMiles } from './distance';

describe('buildCirclePolygonCoordinates', () => {
  it('returns a closed ring (first and last points identical)', () => {
    const coordinates = buildCirclePolygonCoordinates({ lat: 33.0, lng: -96.8 }, 5);
    expect(coordinates[0]).toEqual(coordinates[coordinates.length - 1]);
  });

  it('returns points+1 vertices for the requested point count', () => {
    const coordinates = buildCirclePolygonCoordinates({ lat: 33.0, lng: -96.8 }, 5, 16);
    expect(coordinates).toHaveLength(17);
  });

  it('places every vertex (approximately) radiusMiles from the center', () => {
    const center = { lat: 33.0, lng: -96.8 };
    const radiusMiles = 5;
    const coordinates = buildCirclePolygonCoordinates(center, radiusMiles, 32);

    coordinates.forEach(([lng, lat]) => {
      const distance = haversineDistanceMiles(center, { lat, lng });
      expect(distance).toBeCloseTo(radiusMiles, 2);
    });
  });
});

describe('buildCirclePolygonFeature', () => {
  it('wraps the ring coordinates in a single-ring GeoJSON Polygon Feature', () => {
    const feature = buildCirclePolygonFeature({ lat: 0, lng: 0 }, 1);
    expect(feature.type).toBe('Feature');
    expect(feature.geometry.type).toBe('Polygon');
    expect(feature.geometry.coordinates).toHaveLength(1); // one ring, no holes
  });
});

describe('boundsFromCoordinates', () => {
  it('computes the tight bounding box of a set of points', () => {
    const bounds = boundsFromCoordinates([
      [-10, 5],
      [20, -3],
      [0, 15]
    ]);
    expect(bounds).toEqual({ west: -10, south: -3, east: 20, north: 15 });
  });

  it('matches the extremes of a generated circle (sanity check against buildCirclePolygonCoordinates)', () => {
    const center = { lat: 33.0, lng: -96.8 };
    const bounds = boundsFromCoordinates(buildCirclePolygonCoordinates(center, 5));
    expect(bounds.west).toBeLessThan(center.lng);
    expect(bounds.east).toBeGreaterThan(center.lng);
    expect(bounds.south).toBeLessThan(center.lat);
    expect(bounds.north).toBeGreaterThan(center.lat);
  });
});
