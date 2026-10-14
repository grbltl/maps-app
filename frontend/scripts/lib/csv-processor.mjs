/** Parses RFC 4180 CSV (quoted fields may contain commas, quotes, newlines). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

export const csvField = (value) => `"${String(value).replace(/"/g, '""')}"`;

/** Collapses runs of whitespace and drops periods/backticks ("E.   MAIN BLVD" -> "E MAIN BLVD"). */
export const clean = (value) => (value ?? '').replace(/[.`]/g, ' ').replace(/\s+/g, ' ').trim();

// Street-suffix abbreviations used by the county's data that aren't the USPS
// standard ones, so neither geocoder recognizes them.
export const NONSTANDARD_SUFFIXES = {
  AV: 'AVE', BV: 'BLVD', CR: 'CIR', HY: 'HWY', LP: 'LOOP', PKY: 'PKWY', PY: 'PKWY', RN: 'RUN', WY: 'WAY'
};

/**
 * The street as sent to geocoders: the last word rewritten to its USPS suffix
 * if it's one of NONSTANDARD_SUFFIXES. Only used for geocoding — output keeps
 * the original spelling.
 */
export function geocodableStreet(street) {
  const words = street.split(' ');
  const last = words.length > 1 ? NONSTANDARD_SUFFIXES[words[words.length - 1].toUpperCase()] : undefined;
  if (last) words[words.length - 1] = last;
  return words.join(' ');
}

/** Levenshtein edit distance. */
export function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** "9/1/2026" -> sortable number (20260901); unparseable -> 0. */
export function dateKey(mdy) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(mdy.trim());
  return m ? Number(m[3]) * 10000 + Number(m[1]) * 100 + Number(m[2]) : 0;
}

/**
 * Resolves column name strings to 0-based indexes from a CSV header row.
 * @param {string[]} headers - The CSV header row (first row of the parsed CSV).
 * @param {Record<string, string>} columnNames - Map of field name -> CSV column header.
 * @returns {Record<string, number>} Map of field name -> 0-based column index.
 * @throws if any column name is not found in headers.
 */
export function resolveColumnIndexes(headers, columnNames) {
  const indexes = {};
  const missing = [];
  for (const [field, name] of Object.entries(columnNames)) {
    const idx = headers.indexOf(name);
    if (idx === -1) missing.push(name);
    else indexes[field] = idx;
  }
  if (missing.length) {
    throw new Error(`Column(s) not found in CSV header: ${missing.map((n) => `"${n}"`).join(', ')}`);
  }
  return indexes;
}

/**
 * De-duplicates CSV data rows by stateId column, keeping the row with the
 * latest inspection date. Skips rows whose establishmentType column doesn't
 * match the given value.
 *
 * The fallback key (used when stateId is blank) joins name..zip columns, which
 * assumes colIndexes.name < colIndexes.zip — true for any sensibly ordered CSV.
 *
 * @param {string[][]} rows - Data rows (header already removed).
 * @param {Record<string, number>} colIndexes - From resolveColumnIndexes.
 * @param {string} establishmentType - The value to filter by.
 * @returns {{ deduped: Map<string, string[]>, skippedCount: number }}
 */
export function deduplicateRows(rows, colIndexes, establishmentType) {
  const deduped = new Map();
  let skippedCount = 0;
  for (const cols of rows) {
    if ((cols[colIndexes.establishmentType] ?? '').trim() !== establishmentType) {
      skippedCount++;
      continue;
    }
    const key = cols[colIndexes.stateId]?.trim() || cols.slice(colIndexes.name, colIndexes.zip + 1).join('|');
    const existing = deduped.get(key);
    if (!existing || dateKey(cols[colIndexes.inspectionDate]) >= dateKey(existing[colIndexes.inspectionDate])) {
      deduped.set(key, cols);
    }
  }
  return { deduped, skippedCount };
}

/**
 * Builds normalized record objects from the deduplicated row map.
 * @param {Map<string, string[]>} deduped - From deduplicateRows.
 * @param {Record<string, number>} colIndexes - From resolveColumnIndexes.
 */
export function buildRecords(deduped, colIndexes) {
  return [...deduped].map(([id, cols]) => ({
    id,
    name: clean(cols[colIndexes.name]),
    street: clean(cols[colIndexes.street]),
    unit: clean(cols[colIndexes.unit]),
    city: clean(cols[colIndexes.city]),
    state: clean(cols[colIndexes.state]),
    zip: clean(cols[colIndexes.zip])
  }));
}

const TRUSTED_CITY_MIN_COUNT = 5;
const MAX_CITY_TYPO_DISTANCE = 2;

/**
 * Fixes city typos in place: strips a trailing state suffix ("CHARLOTTE NC" ->
 * "CHARLOTTE"), then snaps rare spellings to the closest trusted city within
 * maxTypoDistance edits (e.g. "CHAROTTE" -> "CHARLOTTE").
 *
 * @param {{ city: string, state: string }[]} records - Modified in place.
 * @param {{ log?: (msg: string) => void, trustedMinCount?: number, maxTypoDistance?: number }} options
 */
export function fixCityTypos(records, options = {}) {
  const {
    log = () => {},
    trustedMinCount = TRUSTED_CITY_MIN_COUNT,
    maxTypoDistance = MAX_CITY_TYPO_DISTANCE
  } = options;

  for (const r of records) {
    const withoutState =
      r.state && r.city.toUpperCase().endsWith(` ${r.state.toUpperCase()}`)
        ? r.city.slice(0, -r.state.length).replace(/[\s,]+$/, '')
        : r.city;
    if (withoutState !== r.city) log(`  city fix: "${r.city}" -> "${withoutState}"`);
    r.city = withoutState;
  }

  const counts = new Map();
  for (const r of records) counts.set(r.city, (counts.get(r.city) ?? 0) + 1);
  const trusted = [...counts].filter(([, n]) => n >= trustedMinCount).map(([city]) => city);

  const corrections = new Map();
  for (const [city, count] of counts) {
    if (count >= trustedMinCount) continue;
    let best = null;
    for (const candidate of trusted) {
      const d = editDistance(city, candidate);
      const better = !best || d < best.d || (d === best.d && counts.get(candidate) > counts.get(best.city));
      if (d <= maxTypoDistance && better) best = { city: candidate, d };
    }
    if (best) corrections.set(city, best.city);
  }
  for (const r of records) r.city = corrections.get(r.city) ?? r.city;
  for (const [from, to] of corrections) log(`  city fix: "${from}" -> "${to}" (${counts.get(from)})`);
}

/**
 * Parses an overrides CSV (with a "coordinates" column header) and returns a
 * Map of id -> { lat, lng } for all rows that have valid coordinates.
 *
 * @param {string} csvText - The full text of the overrides CSV file.
 * @param {{ warn?: (msg: string) => void }} options
 * @returns {Map<string, { lat: number, lng: number }>}
 */
export function parseOverrideCoordinates(csvText, { warn = () => {} } = {}) {
  const allRows = parseCsv(csvText);
  if (!allRows.length) return new Map();
  const [header, ...dataRows] = allRows;
  const coordIdx = header.indexOf('coordinates');
  if (coordIdx === -1) throw new Error('Overrides CSV missing "coordinates" column');

  const coordinates = new Map();
  for (const row of dataRows) {
    const id = row[0];
    const name = row[1];
    const value = (row[coordIdx] ?? '').trim();
    if (!value) continue;
    const parts = value.split(',').map((n) => Number(n.trim()));
    const [lat, lng] = parts;
    const valid = parts.length === 2 && Number.isFinite(lat) && Number.isFinite(lng) &&
      Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    if (valid) coordinates.set(id, { lat, lng });
    else warn(`  Ignoring override for "${name}": "${value}" is not "lat, lng"`);
  }
  return coordinates;
}

/**
 * Returns true if the Nominatim result's house number and zip match the
 * expected values. A rejected result is retried by the caller since Nominatim's
 * top result for the same query can vary between calls.
 *
 * @param {object | null} result - The first element of a Nominatim JSON response.
 * @param {string} houseNumber - Expected house number (e.g. "123").
 * @param {string} zip - Expected zip code (first 5 digits compared).
 */
export function validateNominatimResult(result, houseNumber, zip) {
  if (!result) return false;
  const numbers = (result?.address?.house_number ?? '').split(/[;,]/).map((n) => n.trim().toUpperCase());
  const resultZip = (result?.address?.postcode ?? '').slice(0, 5);
  return numbers.includes(houseNumber.toUpperCase()) && resultZip === zip.slice(0, 5);
}
