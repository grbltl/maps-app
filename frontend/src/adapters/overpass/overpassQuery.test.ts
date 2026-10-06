import { describe, expect, it } from 'vitest';
import { buildOverpassQuery, parseOverpassEntities, type OverpassResponse } from './overpassQuery';

describe('buildOverpassQuery', () => {
  it('builds a node+way query with the tag regex and a meters radius converted from miles', () => {
    const query = buildOverpassQuery(
      { key: 'amenity', values: ['restaurant'] },
      { lat: 33.0023862, lng: -96.795134 },
      5
    );

    expect(query).toBe(
      '[out:json][timeout:25];' +
        '(node["amenity"~"^(restaurant)$"](around:8047,33.0023862,-96.795134);' +
        'way["amenity"~"^(restaurant)$"](around:8047,33.0023862,-96.795134);' +
        ');out center;'
    );
  });

  it('joins multiple category values into one regex alternation', () => {
    const query = buildOverpassQuery(
      { key: 'shop', values: ['clothes', 'shoes'] },
      { lat: 0, lng: 0 },
      1
    );
    expect(query).toContain('["shop"~"^(clothes|shoes)$"]');
  });

  it('escapes regex metacharacters in tag values', () => {
    const query = buildOverpassQuery({ key: 'amenity', values: ['a.b+c'] }, { lat: 0, lng: 0 }, 1);
    expect(query).toContain('a\\.b\\+c');
  });
});

describe('parseOverpassEntities', () => {
  it('uses a node\'s own lat/lon directly', () => {
    const response: OverpassResponse = {
      elements: [
        {
          type: 'node',
          id: 1,
          lat: 33.0023862,
          lon: -96.795134,
          tags: { name: 'Adamos Pizzas', phone: '+1-469-497-1415' }
        }
      ]
    };
    const [entity] = parseOverpassEntities(response, 'Restaurant');
    expect(entity.name).toBe('Adamos Pizzas');
    expect(entity.coordinates).toEqual({ lat: 33.0023862, lng: -96.795134 });
    expect(entity.details?.phone).toBe('+1-469-497-1415');
  });

  it('uses a way\'s computed center when it has no direct lat/lon', () => {
    const response: OverpassResponse = {
      elements: [{ type: 'way', id: 2, center: { lat: 1, lon: 2 }, tags: { name: 'Big Diner' } }]
    };
    const [entity] = parseOverpassEntities(response, 'Restaurant');
    expect(entity.coordinates).toEqual({ lat: 1, lng: 2 });
  });

  it('falls back to the category label when an element has no name tag', () => {
    const response: OverpassResponse = {
      elements: [{ type: 'node', id: 3, lat: 0, lon: 0, tags: {} }]
    };
    const [entity] = parseOverpassEntities(response, 'Restaurant');
    expect(entity.name).toBe('Restaurant');
  });

  it('formats addr:* tags into US mailing-address lines', () => {
    const response: OverpassResponse = {
      elements: [
        {
          type: 'node',
          id: 4,
          lat: 0,
          lon: 0,
          tags: {
            name: 'Adamos Pizzas',
            'addr:housenumber': '18484',
            'addr:street': 'Preston Road',
            'addr:city': 'Dallas',
            'addr:state': 'Texas',
            'addr:postcode': '75252',
            'addr:country': 'US'
          }
        }
      ]
    };
    const [entity] = parseOverpassEntities(response, 'Restaurant');
    expect(entity.details?.address).toEqual(['18484 Preston Rd', 'Dallas, TX 75252']);
  });

  it('skips elements with neither lat/lon nor a center', () => {
    const response: OverpassResponse = {
      elements: [{ type: 'relation', id: 5, tags: { name: 'No coordinates' } }]
    };
    expect(parseOverpassEntities(response, 'Restaurant')).toEqual([]);
  });

  it('prefers "phone" over "contact:phone" and falls back to null when neither is present', () => {
    const response: OverpassResponse = {
      elements: [
        { type: 'node', id: 6, lat: 0, lon: 0, tags: { phone: '111', 'contact:phone': '222' } },
        { type: 'node', id: 7, lat: 0, lon: 0, tags: { 'contact:phone': '222' } },
        { type: 'node', id: 8, lat: 0, lon: 0, tags: {} }
      ]
    };
    const [a, b, c] = parseOverpassEntities(response, 'Restaurant');
    expect(a.details?.phone).toBe('111');
    expect(b.details?.phone).toBe('222');
    expect(c.details?.phone).toBeNull();
  });
});
