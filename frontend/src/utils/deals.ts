import type { Deal } from '../core/types';

/**
 * What: Formats a Date as a local-time "YYYY-MM-DD" calendar date.
 * Why: Deal dates are plain calendar dates, so "today" must be the
 * visitor's local date (not UTC, which can be a day off in the evening) in
 * the same format to compare against them.
 * Without it: Deals could appear to start/end a day early or late depending
 * on the visitor's timezone and time of day.
 * Inputs: date - any Date.
 * Output: The date's local calendar day as "YYYY-MM-DD".
 */
function toLocalIsoDate(date: Date): string {
  const yyyy = String(date.getFullYear()).padStart(4, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * What: Says whether a deal is running on the given day.
 * Why: Data files/DB rows can keep expired or upcoming deals around; only
 * the ones running today should be shown or highlighted.
 * Without it: Expired deals would keep showing until someone removed them by hand.
 * Inputs: deal - the deal to check; today - the day to check against.
 * Output: true if today falls within the deal's (inclusive) start/end
 * dates, treating a missing start/end as open-ended.
 */
export function isDealActive(deal: Deal, today: Date): boolean {
  const day = toLocalIsoDate(today);
  // "YYYY-MM-DD" strings compare correctly as plain strings.
  if (deal.startDate && day < deal.startDate) return false;
  if (deal.endDate && day > deal.endDate) return false;
  return true;
}

/**
 * What: Returns only the deals running on the given day.
 * Why: Shared by the map (highlighting entities with a deal) and the modal
 * (listing them), so both agree on what "active" means.
 * Without it: Each caller would re-implement the filter, risking the marker
 * highlight and the modal disagreeing.
 * Inputs: deals - the entity's deals (may be undefined); today - the day to check against.
 * Output: The active deals, in their original order (empty if none).
 */
export function activeDeals(deals: Deal[] | undefined, today: Date): Deal[] {
  return (deals ?? []).filter((deal) => isDealActive(deal, today));
}
