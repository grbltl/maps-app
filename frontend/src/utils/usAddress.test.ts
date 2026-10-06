import { describe, expect, it } from 'vitest';
import { formatAddressLines } from './usAddress';

describe('formatAddressLines', () => {
  it('formats a standard US address with abbreviated state and street suffix, no comma before zip', () => {
    // Real-world case: Nominatim's display_name duplicated the POI's own
    // name ("Adamos Pizzas, 18484, Preston Road, Dallas, ..."); this must not.
    const lines = formatAddressLines({
      house_number: '18484',
      road: 'Preston Road',
      city: 'Dallas',
      state: 'Texas',
      postcode: '75252',
      country: 'United States',
      country_code: 'us'
    });
    expect(lines).toEqual(['18484 Preston Rd', 'Dallas, TX 75252']);
  });

  it('includes a suite number when present', () => {
    const lines = formatAddressLines({
      house_number: '19251',
      road: 'Preston Road',
      unit: '2',
      city: 'Dallas',
      state: 'Texas',
      postcode: '75252',
      country_code: 'us'
    });
    expect(lines).toEqual(['19251 Preston Rd Suite 2', 'Dallas, TX 75252']);
  });

  it('omits the house number when OSM has no number tagged, rather than showing a blank', () => {
    // Real-world case: "brunch TIME" in Plano, TX has no addr:housenumber in OSM.
    const lines = formatAddressLines({
      road: 'Coit Road',
      city: 'Plano',
      state: 'Texas',
      postcode: '75252',
      country_code: 'us'
    });
    expect(lines).toEqual(['Coit Rd', 'Plano, TX 75252']);
  });

  it('keeps the full state name and country for non-US addresses', () => {
    const lines = formatAddressLines({
      road: 'Downing Street',
      house_number: '10',
      city: 'London',
      country: 'United Kingdom',
      country_code: 'gb'
    });
    expect(lines).toEqual(['10 Downing Street', 'London', 'United Kingdom']);
  });

  it('returns null when there is no address data at all', () => {
    expect(formatAddressLines(null)).toBeNull();
    expect(formatAddressLines(undefined)).toBeNull();
  });
});
