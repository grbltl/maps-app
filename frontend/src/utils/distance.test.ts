import { describe, expect, it } from 'vitest';
import { filterWithinRadius, formatDistanceMiles, haversineDistanceMiles } from './distance';

describe('haversineDistanceMiles', () => {
  it('returns 0 for identical coordinates', () => {
    const point = { lat: 33.0023862, lng: -96.795134 };
    expect(haversineDistanceMiles(point, point)).toBe(0);
  });

  it('matches a known distance within a small tolerance', () => {
    // Dallas, TX -> Fort Worth, TX is roughly 31 miles apart.
    const dallas = { lat: 32.7767, lng: -96.797 };
    const fortWorth = { lat: 32.7555, lng: -97.3308 };
    const miles = haversineDistanceMiles(dallas, fortWorth);
    expect(miles).toBeGreaterThan(28);
    expect(miles).toBeLessThan(34);
  });

  it('is symmetric', () => {
    const a = { lat: 40.7223431, lng: -73.987353 };
    const b = { lat: 40.7484257, lng: -73.98567 };
    expect(haversineDistanceMiles(a, b)).toBeCloseTo(haversineDistanceMiles(b, a), 10);
  });
});

describe('formatDistanceMiles', () => {
  it('rounds to one decimal and appends the unit label', () => {
    expect(formatDistanceMiles(1.84)).toBe('1.8 mi away');
    expect(formatDistanceMiles(0.04)).toBe('0.0 mi away');
  });
});

describe('filterWithinRadius', () => {
  const center = { lat: 32.7767, lng: -96.797 }; // Dallas

  it('keeps items inside the radius and drops items outside it, preserving order', () => {
    const items = [
      { id: 'near', coordinates: { lat: 32.78, lng: -96.8 } }, // well under 1 mi
      { id: 'fortWorth', coordinates: { lat: 32.7555, lng: -97.3308 } }, // ~31 mi
      { id: 'alsoNear', coordinates: { lat: 32.8, lng: -96.79 } } // ~1.6 mi
    ];
    expect(filterWithinRadius(items, center, 5).map((i) => i.id)).toEqual(['near', 'alsoNear']);
  });

  it('treats the radius as inclusive', () => {
    const point = { lat: 32.8, lng: -96.79 };
    const exact = haversineDistanceMiles(center, point);
    expect(filterWithinRadius([{ coordinates: point }], center, exact)).toHaveLength(1);
  });

  it('returns an empty list for no items', () => {
    expect(filterWithinRadius([], center, 5)).toEqual([]);
  });
});
