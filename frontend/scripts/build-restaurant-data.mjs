#!/usr/bin/env node
// Turns the restaurant inspection CSV into public/restaurants.json, the data
// file FileEntityDataConnector serves to the map.
//
// Usage (from frontend/):
//   node scripts/build-restaurant-data.mjs <inspections.csv> [output.json]
//
// - Keeps only rows whose "Establishment Type" is ESTABLISHMENT_TYPE (the
//   app shows a single category - see src/config/entityConfig.ts).
// - The CSV has one row per inspection, so an establishment can appear more
//   than once; rows are de-duplicated by "State ID#", keeping the most recent
//   inspection's name/address.
// - Text is cleaned (extra spaces collapsed, periods dropped) and city
//   typos are fixed (see fixCityTypos) before geocoding and output.
// - Addresses are geocoded once, here, with the US Census Bureau batch
//   geocoder (free, US-only, up to 10,000 addresses per request) - never in
//   the browser, which would be slow and break public geocoders' usage
//   policies. Census misses are retried with Nominatim, accepting only
//   results whose house number and zip match (see geocodeWithNominatim).
// - Coordinates for restaurants neither geocoder can place are entered by
//   hand in OVERRIDES_FILE (next to the input CSV); filled-in rows are used
//   instead of geocoding. The first run creates that file pre-filled with
//   blank rows for the unplaced restaurants; after that it's hand-maintained
//   and never rewritten - delete a row to drop a restaurant from it for good.
//   Unplaced restaurants are left off the map and listed on the console.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const ESTABLISHMENT_TYPE = '1 - Restaurant';
const CENSUS_BATCH_URL = 'https://geocoding.geo.census.gov/geocoder/locations/addressbatch';
const CENSUS_BATCH_LIMIT = 10000;
// Nominatim's usage policy: at most 1 request/second, identifying User-Agent.
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_USER_AGENT = 'map-app restaurant data build (one-off geocoding of public business addresses)';
const NOMINATIM_DELAY_MS = 1100;
const NOMINATIM_ATTEMPTS = 3;
// Hand-entered coordinates for restaurants neither geocoder can place; lives
// next to the input CSV. See readOverrides.
const OVERRIDES_FILE = 'restaurant-coordinate-overrides.csv';
const OVERRIDES_HEADER = ['state_id', 'name', 'street', 'unit', 'city', 'state', 'zip', 'coordinates'];

// A city name is trusted once at least this many establishments use it;
// rarer spellings within MAX_CITY_TYPO_DISTANCE edits of a trusted one are
// treated as typos of it (e.g. "CHAROTTE" -> "CHARLOTTE").
const TRUSTED_CITY_MIN_COUNT = 5;
const MAX_CITY_TYPO_DISTANCE = 2;

// Column indexes (0-based) in the inspection CSV.
const COL = {
  inspectionDate: 0,
  name: 4,
  street: 5,
  unit: 6,
  city: 7,
  state: 8,
  zip: 9,
  stateId: 10,
  establishmentType: 11
};

/** Parses RFC 4180 CSV (quoted fields may contain commas, quotes, newlines). */
function parseCsv(text) {
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

const csvField = (value) => `"${String(value).replace(/"/g, '""')}"`;

/** Collapses runs of whitespace and drops periods/backticks ("E.   INDEPENDENCE BLVD" -> "E INDEPENDENCE BLVD"). */
const clean = (value) => (value ?? '').replace(/[.`]/g, ' ').replace(/\s+/g, ' ').trim();

// Street-suffix abbreviations used by the county's data that aren't the
// USPS standard ones, so neither geocoder recognizes them ("CONNECTION
// POINT BV" finds nothing; "CONNECTION POINT BLVD" does).
const NONSTANDARD_SUFFIXES = {
  AV: 'AVE', BV: 'BLVD', CR: 'CIR', HY: 'HWY', LP: 'LOOP', PKY: 'PKWY', PY: 'PKWY', RN: 'RUN', WY: 'WAY'
};

/**
 * The street as sent to geocoders: the last word rewritten to its USPS
 * suffix if it's one of NONSTANDARD_SUFFIXES. Only used for geocoding - the
 * output keeps the street as the source spells it.
 */
function geocodableStreet(street) {
  const words = street.split(' ');
  const last = words.length > 1 ? NONSTANDARD_SUFFIXES[words[words.length - 1].toUpperCase()] : undefined;
  if (last) words[words.length - 1] = last;
  return words.join(' ');
}

/** Levenshtein edit distance. */
function editDistance(a, b) {
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

/**
 * Fixes city typos in place: strips a trailing state ("CHARLOTTE NC"), then
 * snaps rare spellings to the closest trusted city. Logs every correction so
 * a wrong snap is visible.
 */
function fixCityTypos(records) {
  for (const r of records) {
    const withoutState = r.state && r.city.toUpperCase().endsWith(` ${r.state.toUpperCase()}`)
      ? r.city.slice(0, -r.state.length).replace(/[\s,]+$/, '')
      : r.city;
    if (withoutState !== r.city) console.log(`  city fix: "${r.city}" -> "${withoutState}"`);
    r.city = withoutState;
  }

  const counts = new Map();
  for (const r of records) counts.set(r.city, (counts.get(r.city) ?? 0) + 1);
  const trusted = [...counts].filter(([, n]) => n >= TRUSTED_CITY_MIN_COUNT).map(([city]) => city);

  const corrections = new Map();
  for (const [city, count] of counts) {
    if (count >= TRUSTED_CITY_MIN_COUNT) continue;
    let best = null;
    for (const candidate of trusted) {
      const d = editDistance(city, candidate);
      const better = !best || d < best.d || (d === best.d && counts.get(candidate) > counts.get(best.city));
      if (d <= MAX_CITY_TYPO_DISTANCE && better) best = { city: candidate, d };
    }
    if (best) corrections.set(city, best.city);
  }
  for (const r of records) r.city = corrections.get(r.city) ?? r.city;
  for (const [from, to] of corrections) console.log(`  city fix: "${from}" -> "${to}" (${counts.get(from)})`);
}

/** "9/1/2026" -> sortable number (20260901); unparseable -> 0. */
function dateKey(mdy) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(mdy.trim());
  return m ? Number(m[3]) * 10000 + Number(m[1]) * 100 + Number(m[2]) : 0;
}

/** Geocodes up to CENSUS_BATCH_LIMIT records; returns Map(id -> {lat, lng}). */
async function geocodeBatch(records) {
  const body = records
    .map((r) => [r.id, geocodableStreet(r.street), r.city, r.state, r.zip].map(csvField).join(','))
    .join('\n');
  const form = new FormData();
  form.append('addressFile', new Blob([body], { type: 'text/csv' }), 'addresses.csv');
  form.append('benchmark', 'Public_AR_Current');

  const response = await fetch(CENSUS_BATCH_URL, { method: 'POST', body: form });
  if (!response.ok) throw new Error(`Census geocoder failed: HTTP ${response.status}`);

  // Result columns: id, input address, Match/No_Match/Tie, Exact/Non_Exact,
  // matched address, "lng,lat", TIGER line id, side.
  const located = new Map();
  for (const cols of parseCsv(await response.text())) {
    if (cols[2] !== 'Match') continue;
    const [lng, lat] = cols[5].split(',').map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lng)) located.set(cols[0], { lat, lng });
  }
  return located;
}

/**
 * Fallback for addresses the Census geocoder misses (its street ranges lag
 * behind newer developments). Nominatim's top result is accepted only if its
 * house number and zip both match ours - without that check it happily
 * returns a similarly named street elsewhere (e.g. "3070 DERITA RD" came back
 * as "Derita Creek Road", different zip, no house number).
 * Returns {lat, lng} or null.
 */
async function geocodeWithNominatim(record) {
  const houseNumber = record.street.split(' ')[0];
  if (!/^\d/.test(houseNumber)) return null;

  const params = new URLSearchParams({
    format: 'json',
    limit: '1',
    addressdetails: '1',
    countrycodes: 'us',
    street: geocodableStreet(record.street),
    postalcode: record.zip
  });
  const response = await fetch(`${NOMINATIM_URL}?${params}`, { headers: { 'User-Agent': NOMINATIM_USER_AGENT } });
  if (!response.ok) throw new Error(`Nominatim failed: HTTP ${response.status}`);

  const [result] = await response.json();
  const numbers = (result?.address?.house_number ?? '').split(/[;,]/).map((n) => n.trim().toUpperCase());
  const zip = (result?.address?.postcode ?? '').slice(0, 5);
  if (!numbers.includes(houseNumber.toUpperCase()) || zip !== record.zip.slice(0, 5)) return null;
  return { lat: Number(result.lat), lng: Number(result.lon) };
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function main() {
  const [inputPath, outputPath = 'public/restaurants.json'] = process.argv.slice(2);
  if (!inputPath) {
    console.error('Usage: node scripts/build-restaurant-data.mjs <inspections.csv> [output.json]');
    process.exit(1);
  }

  const [, ...rows] = parseCsv(await readFile(inputPath, 'utf8')); // skip header

  // De-duplicate by State ID#, keeping the latest inspection.
  const latest = new Map();
  let skippedType = 0;
  for (const cols of rows) {
    if ((cols[COL.establishmentType] ?? '').trim() !== ESTABLISHMENT_TYPE) {
      skippedType++;
      continue;
    }
    const key = cols[COL.stateId]?.trim() || cols.slice(COL.name, COL.zip + 1).join('|');
    const existing = latest.get(key);
    if (!existing || dateKey(cols[COL.inspectionDate]) >= dateKey(existing[COL.inspectionDate])) {
      latest.set(key, cols);
    }
  }

  const records = [...latest].map(([id, cols]) => ({
    id,
    name: clean(cols[COL.name]),
    street: clean(cols[COL.street]),
    unit: clean(cols[COL.unit]),
    city: clean(cols[COL.city]),
    state: clean(cols[COL.state]),
    zip: clean(cols[COL.zip])
  }));
  console.log(
    `${rows.length} rows -> ${records.length} unique establishments ` +
      `(${skippedType} rows skipped as not "${ESTABLISHMENT_TYPE}")`
  );
  fixCityTypos(records);

  const overridesPath = join(dirname(inputPath), OVERRIDES_FILE);
  const overrides = await readOverrides(overridesPath);
  const located = new Map();
  for (const r of records) {
    const coords = overrides.coordinates.get(r.id);
    if (coords) located.set(r.id, coords);
  }
  if (located.size) console.log(`Using ${located.size} hand-entered coordinates from ${overridesPath}`);

  const toGeocode = records.filter((r) => !located.has(r.id));
  for (let i = 0; i < toGeocode.length; i += CENSUS_BATCH_LIMIT) {
    const batch = toGeocode.slice(i, i + CENSUS_BATCH_LIMIT);
    console.log(`Geocoding ${i + 1}-${i + batch.length} of ${toGeocode.length}...`);
    for (const [id, coords] of await geocodeBatch(batch)) located.set(id, coords);
  }

  const misses = records.filter((r) => !located.has(r.id));
  if (misses.length) {
    console.log(`Retrying ${misses.length} misses with Nominatim (~${Math.ceil((misses.length * NOMINATIM_DELAY_MS) / 60000)} min)...`);
    let recovered = 0;
    for (const r of misses) {
      // Nominatim's top result for the same query varies between calls (seen:
      // "7806 FOREST POINT BV" matched exactly twice, then came back as the
      // wrong stretch of road), so a rejected answer is retried.
      for (let attempt = 1; attempt <= NOMINATIM_ATTEMPTS; attempt++) {
        const coords = await geocodeWithNominatim(r);
        await sleep(NOMINATIM_DELAY_MS);
        if (coords) {
          located.set(r.id, coords);
          recovered++;
          break;
        }
      }
    }
    console.log(`  Nominatim recovered ${recovered} of ${misses.length}`);
  }

  const output = [];
  const unmatched = [];
  for (const r of records) {
    const coords = located.get(r.id);
    if (!coords) {
      unmatched.push(r);
      continue;
    }
    const { id: _id, unit, ...rest } = r;
    output.push({ ...rest, ...(unit ? { unit } : {}), ...coords });
  }

  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  await writeFile(outputPath, JSON.stringify(output));
  console.log(`Wrote ${output.length} restaurants to ${outputPath}`);

  if (unmatched.length) {
    console.warn(`${unmatched.length} restaurants have no coordinates and are left off the map:`);
    for (const r of unmatched) console.warn(`  ${r.id}  ${r.name} - ${r.street}, ${r.city} ${r.zip}`);
    if (!overrides.exists) {
      const rows = unmatched.map((r) => [r.id, r.name, r.street, r.unit, r.city, r.state, r.zip, '']);
      const lines = [OVERRIDES_HEADER, ...rows].map((l) => l.map(csvField).join(','));
      await writeFile(overridesPath, lines.join('\n') + '\n');
      console.warn(`Created ${overridesPath} - fill in the "coordinates" column for these and rerun.`);
    } else {
      console.warn(`To place one, add its row with coordinates to ${overridesPath} and rerun.`);
    }
  }
}

/**
 * Reads the hand-maintained coordinate overrides (missing file = none).
 * The "coordinates" column takes "lat, lng" exactly as Google Maps copies it
 * (right-click a spot -> click the coordinates). Rows are keyed by State ID#,
 * so they survive re-exports of the inspection CSV.
 * Returns { exists, coordinates: Map(id -> {lat, lng}) }.
 */
async function readOverrides(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, coordinates: new Map() };
    throw error;
  }
  const [, ...rows] = parseCsv(text);
  const coordinates = new Map();
  for (const row of rows) {
    const [id, name] = row;
    const value = (row[OVERRIDES_HEADER.length - 1] ?? '').trim();
    if (!value) continue;
    const [lat, lng, extra] = value.split(',').map((n) => Number(n.trim()));
    const valid = extra === undefined && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    if (valid) coordinates.set(id, { lat, lng });
    else console.warn(`  Ignoring override for "${name}": "${value}" is not "lat, lng"`);
  }
  return { exists: true, coordinates };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
