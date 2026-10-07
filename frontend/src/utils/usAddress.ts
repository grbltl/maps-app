// Formats a Nominatim-style structured address into standard US mailing-
// address form: ["street line (with suite if applicable)", "City, ST zip"] -
// state abbreviated, no comma between state and zip. Built from structured
// fields rather than a vendor's raw display string, which typically leads
// with the POI's own name/category (duplicating what's already shown as the
// entity's title).

export interface StructuredAddress {
  house_number?: string;
  road?: string;
  unit?: string;
  city?: string;
  town?: string;
  village?: string;
  suburb?: string;
  neighbourhood?: string;
  state?: string;
  postcode?: string;
  country?: string;
  country_code?: string;
}

const US_STATE_ABBREVIATIONS: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC',
  Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL',
  Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA',
  Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
  Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR',
  Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD',
  Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA',
  Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
  'Puerto Rico': 'PR', Guam: 'GU', 'American Samoa': 'AS',
  'United States Virgin Islands': 'VI', 'Northern Mariana Islands': 'MP'
};

const STREET_SUFFIX_ABBREVIATIONS: Record<string, string> = {
  street: 'St', avenue: 'Ave', boulevard: 'Blvd', drive: 'Dr', road: 'Rd',
  lane: 'Ln', court: 'Ct', place: 'Pl', highway: 'Hwy', parkway: 'Pkwy',
  circle: 'Cir', terrace: 'Ter', trail: 'Trl', square: 'Sq', plaza: 'Plz'
};

/**
 * What: Abbreviates a US street suffix (e.g. "Road" -> "Rd") if the road
 * name ends with one it recognizes.
 * Why: Standard US mailing-address form abbreviates common street suffixes;
 * this is only ever called for US addresses (see formatAddressLines) since
 * other countries conventionally spell the suffix out.
 * Without it: US addresses would show full suffix words (e.g. "18484
 * Preston Road" instead of "18484 Preston Rd"), inconsistent with how US
 * addresses are normally written.
 * Inputs: road - the road name, or undefined if the address has none.
 * Output: The road name with its last word abbreviated if recognized,
 * unchanged otherwise; undefined passes through unchanged.
 */
function abbreviateStreetSuffix(road: string | undefined): string | undefined {
  if (!road) return road;
  const words = road.split(' ');
  const lastWord = words[words.length - 1];
  const abbreviation = STREET_SUFFIX_ABBREVIATIONS[lastWord.toLowerCase()];
  // All-caps sources (e.g. "MOREHEAD STREET") keep their casing.
  if (abbreviation) {
    words[words.length - 1] = lastWord === lastWord.toUpperCase() ? abbreviation.toUpperCase() : abbreviation;
  }
  return words.join(' ');
}

// Secondary-unit designators that a unit value may already start with
// ("SUITE 100", "Ste 4", "#12").
const UNIT_DESIGNATOR = /^(#|(apt|apartment|bldg|building|dept|fl|floor|lot|rm|room|spc|space|ste|suite|trlr|unit)\b)/i;

/**
 * What: Appends a unit to a street line, adding "Suite" only when the unit
 * is a bare number/letter.
 * Why: Some sources store just "2", others the full "SUITE 100" - blindly
 * prefixing "Suite" would turn the latter into "Suite SUITE 100".
 * Without it: Units that already carry a designator would show it twice.
 * Inputs: street - the street line; unit - the unit, or undefined.
 * Output: The street line with the unit appended, if any.
 */
function appendUnit(street: string, unit: string | undefined): string {
  if (!unit) return street;
  return UNIT_DESIGNATOR.test(unit) ? `${street} ${unit}` : `${street} Suite ${unit}`;
}

/**
 * What: Formats a Nominatim-style structured address into display lines -
 * US addresses as ["street line (+ suite if present)", "City, ST zip"]
 * (state abbreviated, no comma before the zip); non-US addresses as
 * ["street line", "City, region", "Country"] (state/country spelled out, no
 * standard abbreviation convention to apply).
 * Why: Built from structured fields (house_number/road/city/state/...)
 * rather than a geocoding vendor's raw display string, which typically leads
 * with the POI's own name/category - duplicating what's already shown
 * elsewhere as the entity's title - and doesn't follow any particular
 * country's mailing-address convention.
 * Without it: The modal would show a vendor's raw, unformatted address
 * string, which (at least for Nominatim) redundantly repeats the entity's
 * name and doesn't read like a standard US mailing address.
 * Inputs: address - a StructuredAddress (all fields optional, since real
 * address data is often incomplete - e.g. some OSM places have no tagged
 * house number), or null/undefined if no address data exists at all.
 * Output: An array of display lines, or null if there's no usable address
 * data to show at all.
 */
export function formatAddressLines(address: StructuredAddress | null | undefined): string[] | null {
  if (!address) return null;

  const locality =
    address.city || address.town || address.village || address.suburb || address.neighbourhood;

  // Street-suffix abbreviation (Street -> St) is a US mailing-address
  // convention; other countries conventionally spell it out (e.g. "10
  // Downing Street", not "10 Downing St").
  if (address.country_code === 'us') {
    const street = [address.house_number, abbreviateStreetSuffix(address.road)].filter(Boolean).join(' ');
    const streetWithUnit = appendUnit(street, address.unit);

    const state = (address.state && US_STATE_ABBREVIATIONS[address.state]) || address.state;
    const cityStateZip = [locality, [state, address.postcode].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', ');
    const lines = [streetWithUnit, cityStateZip].filter(Boolean);
    return lines.length ? lines : null;
  }

  const street = [address.house_number, address.road].filter(Boolean).join(' ');
  const streetWithUnit = appendUnit(street, address.unit);

  // Non-US: no standard state-abbreviation convention, so keep the state name and include the country.
  const region = [address.state, address.postcode].filter(Boolean).join(' ');
  const lines = [streetWithUnit, [locality, region].filter(Boolean).join(', '), address.country].filter(
    Boolean
  ) as string[];
  return lines.length ? lines : null;
}
