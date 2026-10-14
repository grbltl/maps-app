// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  parseCsv,
  csvField,
  clean,
  geocodableStreet,
  editDistance,
  dateKey,
  resolveColumnIndexes,
  deduplicateRows,
  buildRecords,
  fixCityTypos,
  parseOverrideCoordinates,
  validateNominatimResult
} from './csv-processor.mjs';

// ---------------------------------------------------------------------------
// parseCsv
// ---------------------------------------------------------------------------

describe('parseCsv', () => {
  it('parses a simple CSV', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3']
    ]);
  });

  it('handles quoted fields containing commas', () => {
    expect(parseCsv('"a,b",c')).toEqual([['a,b', 'c']]);
  });

  it('handles quoted fields containing embedded newlines', () => {
    expect(parseCsv('"a\nb",c')).toEqual([['a\nb', 'c']]);
  });

  it('handles escaped quotes (doubled)', () => {
    expect(parseCsv('"a""b",c')).toEqual([['a"b', 'c']]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ]);
  });

  it('skips blank lines', () => {
    expect(parseCsv('a,b\n\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ]);
  });

  it('handles empty fields', () => {
    expect(parseCsv('a,,c')).toEqual([['a', '', 'c']]);
  });

  it('handles a single field with no delimiter', () => {
    expect(parseCsv('hello')).toEqual([['hello']]);
  });

  it('returns an empty array for whitespace-only input', () => {
    expect(parseCsv('   \n  \n')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// csvField
// ---------------------------------------------------------------------------

describe('csvField', () => {
  it('wraps the value in double quotes', () => {
    expect(csvField('hello')).toBe('"hello"');
  });

  it('escapes internal double quotes by doubling them', () => {
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
  });

  it('handles an empty string', () => {
    expect(csvField('')).toBe('""');
  });

  it('coerces numbers to strings', () => {
    expect(csvField(42)).toBe('"42"');
  });
});

// ---------------------------------------------------------------------------
// clean
// ---------------------------------------------------------------------------

describe('clean', () => {
  it('collapses multiple spaces', () => {
    expect(clean('E   INDEPENDENCE   BLVD')).toBe('E INDEPENDENCE BLVD');
  });

  it('removes periods', () => {
    expect(clean('E. INDEPENDENCE BLVD')).toBe('E INDEPENDENCE BLVD');
  });

  it('removes backticks', () => {
    expect(clean('MAIN`STREET')).toBe('MAIN STREET');
  });

  it('trims leading and trailing whitespace', () => {
    expect(clean('  hello  ')).toBe('hello');
  });

  it('handles null', () => {
    expect(clean(null)).toBe('');
  });

  it('handles undefined', () => {
    expect(clean(undefined)).toBe('');
  });

  it('handles an empty string', () => {
    expect(clean('')).toBe('');
  });

  it('collapses spaces introduced by period removal', () => {
    expect(clean('E.   INDEPENDENCE BLVD')).toBe('E INDEPENDENCE BLVD');
  });
});

// ---------------------------------------------------------------------------
// geocodableStreet
// ---------------------------------------------------------------------------

describe('geocodableStreet', () => {
  it('rewrites a BV suffix to BLVD', () => {
    expect(geocodableStreet('CONNECTION POINT BV')).toBe('CONNECTION POINT BLVD');
  });

  it('rewrites a HY suffix to HWY', () => {
    expect(geocodableStreet('123 MAIN HY')).toBe('123 MAIN HWY');
  });

  it('rewrites a PY suffix to PKWY', () => {
    expect(geocodableStreet('100 QUEENS RD PY')).toBe('100 QUEENS RD PKWY');
  });

  it('leaves a standard suffix unchanged', () => {
    expect(geocodableStreet('123 MAIN ST')).toBe('123 MAIN ST');
    expect(geocodableStreet('456 OAK AVE')).toBe('456 OAK AVE');
  });

  it('is case-insensitive when matching the suffix', () => {
    expect(geocodableStreet('100 FOREST POINT Bv')).toBe('100 FOREST POINT BLVD');
  });

  it('does not rewrite a single-word street (no suffix to replace)', () => {
    expect(geocodableStreet('BV')).toBe('BV');
  });
});

// ---------------------------------------------------------------------------
// editDistance
// ---------------------------------------------------------------------------

describe('editDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(editDistance('CHARLOTTE', 'CHARLOTTE')).toBe(0);
  });

  it('counts a single insertion', () => {
    expect(editDistance('CAT', 'CATS')).toBe(1);
  });

  it('counts a single deletion', () => {
    expect(editDistance('CATS', 'CAT')).toBe(1);
  });

  it('counts a single substitution', () => {
    expect(editDistance('CAT', 'BAT')).toBe(1);
  });

  it('measures the real-world CHAROTTE -> CHARLOTTE typo (one insertion)', () => {
    expect(editDistance('CHAROTTE', 'CHARLOTTE')).toBe(1);
  });

  it('handles empty strings', () => {
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('abc', '')).toBe(3);
    expect(editDistance('', '')).toBe(0);
  });

  it('is symmetric', () => {
    expect(editDistance('KITTEN', 'SITTING')).toBe(editDistance('SITTING', 'KITTEN'));
  });
});

// ---------------------------------------------------------------------------
// dateKey
// ---------------------------------------------------------------------------

describe('dateKey', () => {
  it('converts M/D/YYYY to a sortable number', () => {
    expect(dateKey('9/1/2026')).toBe(20260901);
    expect(dateKey('12/31/2025')).toBe(20251231);
    expect(dateKey('1/5/2024')).toBe(20240105);
  });

  it('returns 0 for an empty string', () => {
    expect(dateKey('')).toBe(0);
  });

  it('returns 0 for a non-date string', () => {
    expect(dateKey('not-a-date')).toBe(0);
  });

  it('returns 0 for ISO format (YYYY-MM-DD), which is not accepted', () => {
    expect(dateKey('2026-09-01')).toBe(0);
  });

  it('allows later dates to sort after earlier dates', () => {
    expect(dateKey('12/31/2025')).toBeGreaterThan(dateKey('1/1/2025'));
    expect(dateKey('1/1/2026')).toBeGreaterThan(dateKey('12/31/2025'));
  });

  it('trims surrounding whitespace', () => {
    expect(dateKey('  9/1/2026  ')).toBe(20260901);
  });
});

// ---------------------------------------------------------------------------
// resolveColumnIndexes
// ---------------------------------------------------------------------------

describe('resolveColumnIndexes', () => {
  const headers = ['Date', 'Name', 'Street', 'City', 'State', 'Zip'];

  it('maps field names to their 0-based column indexes', () => {
    const result = resolveColumnIndexes(headers, { date: 'Date', city: 'City' });
    expect(result).toEqual({ date: 0, city: 3 });
  });

  it('handles all columns being found', () => {
    const result = resolveColumnIndexes(headers, {
      a: 'Date', b: 'Name', c: 'Street', d: 'City', e: 'State', f: 'Zip'
    });
    expect(result).toEqual({ a: 0, b: 1, c: 2, d: 3, e: 4, f: 5 });
  });

  it('throws for a single missing column', () => {
    expect(() => resolveColumnIndexes(headers, { foo: 'Missing Column' }))
      .toThrow('"Missing Column"');
  });

  it('throws listing all missing columns', () => {
    expect(() => resolveColumnIndexes(headers, { a: 'Alpha', b: 'Beta' }))
      .toThrow('"Alpha"');
  });

  it('is case-sensitive', () => {
    expect(() => resolveColumnIndexes(headers, { date: 'date' })).toThrow();
  });

  it('returns an empty object when columnNames is empty', () => {
    expect(resolveColumnIndexes(headers, {})).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// deduplicateRows
// ---------------------------------------------------------------------------

describe('deduplicateRows', () => {
  // colIndexes matching the test row layout below
  const col = {
    inspectionDate: 0,
    name: 1,
    street: 2,
    unit: 3,
    city: 4,
    state: 5,
    zip: 6,
    stateId: 7,
    establishmentType: 8
  };
  const TYPE = '1 - Restaurant';

  const makeRow = (date, name, stateId, type = TYPE) =>
    [date, name, '123 Main St', '', 'Charlotte', 'NC', '28201', stateId, type];

  it('returns one record per unique stateId', () => {
    const rows = [makeRow('1/1/2025', 'Bistro A', 'S001'), makeRow('2/1/2025', 'Bistro A', 'S001')];
    const { deduped } = deduplicateRows(rows, col, TYPE);
    expect(deduped.size).toBe(1);
  });

  it('keeps the row with the latest inspection date', () => {
    const rows = [makeRow('1/1/2025', 'Old Name', 'S001'), makeRow('2/1/2025', 'New Name', 'S001')];
    const { deduped } = deduplicateRows(rows, col, TYPE);
    expect(deduped.get('S001')[col.name]).toBe('New Name');
  });

  it('keeps the later row when dates are equal', () => {
    const rows = [makeRow('1/1/2025', 'First', 'S001'), makeRow('1/1/2025', 'Second', 'S001')];
    const { deduped } = deduplicateRows(rows, col, TYPE);
    expect(deduped.get('S001')[col.name]).toBe('Second');
  });

  it('skips rows with a non-matching establishment type and counts them', () => {
    const rows = [makeRow('1/1/2025', 'Restaurant', 'S001'), makeRow('1/1/2025', 'Grocery', 'S002', 'Grocery Store')];
    const { deduped, skippedCount } = deduplicateRows(rows, col, TYPE);
    expect(deduped.size).toBe(1);
    expect(skippedCount).toBe(1);
  });

  it('handles multiple distinct establishments', () => {
    const rows = [makeRow('1/1/2025', 'A', 'S001'), makeRow('1/1/2025', 'B', 'S002')];
    const { deduped } = deduplicateRows(rows, col, TYPE);
    expect(deduped.size).toBe(2);
  });

  it('returns skippedCount 0 when all rows match', () => {
    const rows = [makeRow('1/1/2025', 'A', 'S001')];
    const { skippedCount } = deduplicateRows(rows, col, TYPE);
    expect(skippedCount).toBe(0);
  });

  it('returns an empty map for an empty input', () => {
    const { deduped, skippedCount } = deduplicateRows([], col, TYPE);
    expect(deduped.size).toBe(0);
    expect(skippedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildRecords
// ---------------------------------------------------------------------------

describe('buildRecords', () => {
  const col = { name: 0, street: 1, unit: 2, city: 3, state: 4, zip: 5 };

  it('creates a record for each entry in the deduped map', () => {
    const deduped = new Map([['S001', ['Bistro A', '123 Main St', 'Suite 1', 'Charlotte', 'NC', '28201']]]);
    expect(buildRecords(deduped, col)).toEqual([
      { id: 'S001', name: 'Bistro A', street: '123 Main St', unit: 'Suite 1', city: 'Charlotte', state: 'NC', zip: '28201' }
    ]);
  });

  it('applies clean() to all string fields', () => {
    const deduped = new Map([['S001', ['E.  Bistro', '123  Main.  St', '', 'Charlotte', 'NC', '28201']]]);
    const [record] = buildRecords(deduped, col);
    expect(record.name).toBe('E Bistro');
    expect(record.street).toBe('123 Main St');
    expect(record.unit).toBe('');
  });

  it('uses the map key as the record id', () => {
    const deduped = new Map([['MY-ID', ['A', 'B', '', 'C', 'D', 'E']]]);
    const [record] = buildRecords(deduped, col);
    expect(record.id).toBe('MY-ID');
  });

  it('returns an empty array for an empty map', () => {
    expect(buildRecords(new Map(), col)).toEqual([]);
  });

  it('preserves insertion order of the map', () => {
    const deduped = new Map([
      ['S001', ['Alpha', 'St A', '', 'C', 'S', 'Z']],
      ['S002', ['Beta', 'St B', '', 'C', 'S', 'Z']]
    ]);
    const records = buildRecords(deduped, col);
    expect(records.map((r) => r.id)).toEqual(['S001', 'S002']);
  });
});

// ---------------------------------------------------------------------------
// fixCityTypos
// ---------------------------------------------------------------------------

describe('fixCityTypos', () => {
  const nc = (city) => ({ city, state: 'NC' });

  it('strips a trailing state abbreviation from the city', () => {
    const records = [nc('CHARLOTTE NC')];
    fixCityTypos(records);
    expect(records[0].city).toBe('CHARLOTTE');
  });

  it('strips a trailing state even when it follows a comma', () => {
    const records = [{ city: 'CHARLOTTE, NC', state: 'NC' }];
    fixCityTypos(records);
    expect(records[0].city).toBe('CHARLOTTE');
  });

  it('corrects a typo city to the nearest trusted city', () => {
    const records = [
      ...Array(5).fill(null).map(() => nc('CHARLOTTE')),
      nc('CHAROTTE') // 2 edits away from CHARLOTTE
    ];
    fixCityTypos(records, { trustedMinCount: 5, maxTypoDistance: 2 });
    expect(records[5].city).toBe('CHARLOTTE');
  });

  it('does not snap a city that exceeds the maximum edit distance', () => {
    const records = [
      ...Array(5).fill(null).map(() => nc('CHARLOTTE')),
      nc('COMPLETELY DIFFERENT')
    ];
    fixCityTypos(records, { trustedMinCount: 5, maxTypoDistance: 2 });
    expect(records[5].city).toBe('COMPLETELY DIFFERENT');
  });

  it('does not alter trusted cities', () => {
    const records = Array(5).fill(null).map(() => nc('CHARLOTTE'));
    fixCityTypos(records);
    expect(records.every((r) => r.city === 'CHARLOTTE')).toBe(true);
  });

  it('calls the log function for state-strip corrections', () => {
    const logs = [];
    const records = [nc('CHARLOTTE NC')];
    fixCityTypos(records, { log: (m) => logs.push(m) });
    expect(logs.some((l) => l.includes('CHARLOTTE NC'))).toBe(true);
  });

  it('calls the log function for typo corrections', () => {
    const logs = [];
    const records = [
      ...Array(5).fill(null).map(() => nc('CHARLOTTE')),
      nc('CHAROTTE')
    ];
    fixCityTypos(records, { log: (m) => logs.push(m), trustedMinCount: 5, maxTypoDistance: 2 });
    expect(logs.some((l) => l.includes('CHAROTTE'))).toBe(true);
  });

  it('does not call log when there are no corrections', () => {
    const logs = [];
    const records = Array(5).fill(null).map(() => nc('CHARLOTTE'));
    fixCityTypos(records, { log: (m) => logs.push(m) });
    expect(logs).toEqual([]);
  });

  it('respects a custom trustedMinCount', () => {
    // With trustedMinCount: 3, a city with 3 occurrences becomes trusted
    const records = [
      ...Array(3).fill(null).map(() => nc('CHARLOTTE')),
      nc('CHAROTTE')
    ];
    fixCityTypos(records, { trustedMinCount: 3, maxTypoDistance: 2 });
    expect(records[3].city).toBe('CHARLOTTE');
  });
});

// ---------------------------------------------------------------------------
// parseOverrideCoordinates
// ---------------------------------------------------------------------------

describe('parseOverrideCoordinates', () => {
  const HEADER = 'state_id,name,street,unit,city,state,zip,coordinates';

  it('parses a valid coordinate entry', () => {
    const csv = `${HEADER}\nS001,Bistro A,123 Main,,Charlotte,NC,28201,"35.2271, -80.8431"`;
    const result = parseOverrideCoordinates(csv);
    expect(result.get('S001')).toEqual({ lat: 35.2271, lng: -80.8431 });
  });

  it('skips rows with an empty coordinates field', () => {
    const csv = `${HEADER}\nS001,Bistro A,123 Main,,Charlotte,NC,28201,`;
    expect(parseOverrideCoordinates(csv).has('S001')).toBe(false);
  });

  it('rejects and warns for coordinates with more than two parts', () => {
    const warns = [];
    const csv = `${HEADER}\nS001,Bistro A,123 Main,,Charlotte,NC,28201,"35.2271, -80.8431, 100"`;
    const result = parseOverrideCoordinates(csv, { warn: (m) => warns.push(m) });
    expect(result.has('S001')).toBe(false);
    expect(warns.length).toBe(1);
  });

  it('rejects coordinates where lat is out of range', () => {
    const warns = [];
    const csv = `${HEADER}\nS001,Bistro A,123 Main,,Charlotte,NC,28201,"200, -80.8431"`;
    parseOverrideCoordinates(csv, { warn: (m) => warns.push(m) });
    expect(warns.length).toBe(1);
  });

  it('rejects coordinates where lng is out of range', () => {
    const warns = [];
    const csv = `${HEADER}\nS001,Bistro A,123 Main,,Charlotte,NC,28201,"35.2271, 200"`;
    parseOverrideCoordinates(csv, { warn: (m) => warns.push(m) });
    expect(warns.length).toBe(1);
  });

  it('returns an empty Map when only the header is present', () => {
    expect(parseOverrideCoordinates(HEADER).size).toBe(0);
  });

  it('returns an empty Map for an empty string', () => {
    expect(parseOverrideCoordinates('').size).toBe(0);
  });

  it('throws when the "coordinates" column is missing from the header', () => {
    expect(() => parseOverrideCoordinates('state_id,name,lat,lng')).toThrow('"coordinates"');
  });

  it('handles multiple valid entries', () => {
    const csv = [
      HEADER,
      'S001,A,,,,,,"35.2271, -80.8431"',
      'S002,B,,,,,,"35.3000, -80.9000"'
    ].join('\n');
    const result = parseOverrideCoordinates(csv);
    expect(result.size).toBe(2);
    expect(result.get('S002')).toEqual({ lat: 35.3, lng: -80.9 });
  });
});

// ---------------------------------------------------------------------------
// validateNominatimResult
// ---------------------------------------------------------------------------

describe('validateNominatimResult', () => {
  const makeResult = (houseNumber, postcode) => ({
    lat: '35.2271',
    lon: '-80.8431',
    address: { house_number: houseNumber, postcode }
  });

  it('returns true when house number and zip both match', () => {
    expect(validateNominatimResult(makeResult('123', '28201'), '123', '28201')).toBe(true);
  });

  it('returns false when the house number does not match', () => {
    expect(validateNominatimResult(makeResult('456', '28201'), '123', '28201')).toBe(false);
  });

  it('returns false when the zip does not match', () => {
    expect(validateNominatimResult(makeResult('123', '27000'), '123', '28201')).toBe(false);
  });

  it('returns false for a null result', () => {
    expect(validateNominatimResult(null, '123', '28201')).toBe(false);
  });

  it('handles semicolon-separated house numbers', () => {
    expect(validateNominatimResult(makeResult('100;123;150', '28201'), '123', '28201')).toBe(true);
  });

  it('handles comma-separated house numbers', () => {
    expect(validateNominatimResult(makeResult('100,123,150', '28201'), '123', '28201')).toBe(true);
  });

  it('is case-insensitive for the house number comparison', () => {
    expect(validateNominatimResult(makeResult('123A', '28201'), '123a', '28201')).toBe(true);
  });

  it('compares only the first 5 digits of the zip', () => {
    expect(validateNominatimResult(makeResult('123', '28201-5678'), '123', '28201-1234')).toBe(true);
  });

  it('returns false when house_number is absent from the result', () => {
    const result = { lat: '35.2271', lon: '-80.8431', address: { postcode: '28201' } };
    expect(validateNominatimResult(result, '123', '28201')).toBe(false);
  });

  it('returns false when postcode is absent from the result', () => {
    const result = { lat: '35.2271', lon: '-80.8431', address: { house_number: '123' } };
    expect(validateNominatimResult(result, '123', '28201')).toBe(false);
  });
});
