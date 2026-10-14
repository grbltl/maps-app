#!/usr/bin/env node
// Turns an inspection CSV into public/restaurants.json, the data file
// FileEntityDataConnector serves to the map.
//
// Usage (from frontend/):
//   node scripts/build-restaurant-data.mjs <inspections.csv> [output.json] [options]
//
// Column name options (defaults in DEFAULT_COLUMN_NAMES below):
//   --col-date=<name>
//   --col-name=<name>
//   --col-street=<name>
//   --col-unit=<name>
//   --col-city=<name>
//   --col-state=<name>
//   --col-zip=<name>
//   --col-state-id=<name>
//   --col-establishment-type=<name>
//   --establishment-type=<value>   (the row filter value; default: "1 - Restaurant")

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  parseCsv,
  csvField,
  geocodableStreet,
  validateNominatimResult,
  resolveColumnIndexes,
  deduplicateRows,
  buildRecords,
  fixCityTypos,
  parseOverrideCoordinates
} from './lib/csv-processor.mjs';

const CENSUS_BATCH_URL = 'https://geocoding.geo.census.gov/geocoder/locations/addressbatch';
const CENSUS_BATCH_LIMIT = 10000;
// Nominatim's usage policy: at most 1 request/second, identifying User-Agent.
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_USER_AGENT = 'map-app restaurant data build (one-off geocoding of public business addresses)';
const NOMINATIM_DELAY_MS = 1100;
const NOMINATIM_ATTEMPTS = 3;
// Hand-entered coordinates for restaurants neither geocoder can place; lives
// next to the input CSV.
const OVERRIDES_FILE = 'restaurant-coordinate-overrides.csv';
const OVERRIDES_HEADER = ['state_id', 'name', 'street', 'unit', 'city', 'state', 'zip', 'coordinates'];

// Default column header names expected in the inspection CSV. Override any of
// these with --col-<field>=<name> to match a different CSV schema.
const DEFAULT_COLUMN_NAMES = {
  inspectionDate: 'Date',
  name: 'Premise Name',
  street: 'Address Street',
  unit: 'Address Suite/Unit',
  city: 'City',
  state: 'State',
  zip: 'Zip',
  stateId: 'State ID#',
  establishmentType: 'Establishment Type'
};

function parseArgs(argv) {
  const positional = [];
  const columnNames = { ...DEFAULT_COLUMN_NAMES };
  let establishmentType = '1 - Restaurant';

  for (const arg of argv) {
    const eqIdx = arg.indexOf('=');
    const flag = eqIdx === -1 ? arg : arg.slice(0, eqIdx);
    const val = eqIdx === -1 ? '' : arg.slice(eqIdx + 1);

    if (flag === '--col-date') columnNames.inspectionDate = val;
    else if (flag === '--col-name') columnNames.name = val;
    else if (flag === '--col-street') columnNames.street = val;
    else if (flag === '--col-unit') columnNames.unit = val;
    else if (flag === '--col-city') columnNames.city = val;
    else if (flag === '--col-state') columnNames.state = val;
    else if (flag === '--col-zip') columnNames.zip = val;
    else if (flag === '--col-state-id') columnNames.stateId = val;
    else if (flag === '--col-establishment-type') columnNames.establishmentType = val;
    else if (flag === '--establishment-type') establishmentType = val;
    else if (!arg.startsWith('--')) positional.push(arg);
  }

  return { positional, columnNames, establishmentType };
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
 * Fallback for addresses the Census geocoder misses. Nominatim's top result is
 * accepted only if its house number and zip both match — see validateNominatimResult.
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
  const response = await fetch(`${NOMINATIM_URL}?${params}`, {
    headers: { 'User-Agent': NOMINATIM_USER_AGENT }
  });
  if (!response.ok) throw new Error(`Nominatim failed: HTTP ${response.status}`);

  const [result] = await response.json();
  if (!validateNominatimResult(result, houseNumber, record.zip)) return null;
  return { lat: Number(result.lat), lng: Number(result.lon) };
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function readOverrides(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, coordinates: new Map() };
    throw error;
  }
  const coordinates = parseOverrideCoordinates(text, { warn: console.warn });
  return { exists: true, coordinates };
}

async function main() {
  const { positional, columnNames, establishmentType } = parseArgs(process.argv.slice(2));
  const [inputPath, outputPath = 'public/restaurants.json'] = positional;

  if (!inputPath) {
    console.error(
      'Usage: node scripts/build-restaurant-data.mjs <inspections.csv> [output.json] [--col-<field>=<name> ...]'
    );
    process.exit(1);
  }

  const [headerRow, ...dataRows] = parseCsv(await readFile(inputPath, 'utf8'));
  const colIndexes = resolveColumnIndexes(headerRow, columnNames);

  const { deduped, skippedCount } = deduplicateRows(dataRows, colIndexes, establishmentType);
  const records = buildRecords(deduped, colIndexes);
  console.log(
    `${dataRows.length} rows -> ${records.length} unique establishments ` +
      `(${skippedCount} rows skipped as not "${establishmentType}")`
  );
  fixCityTypos(records, { log: console.log });

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
    console.log(
      `Retrying ${misses.length} misses with Nominatim (~${Math.ceil((misses.length * NOMINATIM_DELAY_MS) / 60000)} min)...`
    );
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
