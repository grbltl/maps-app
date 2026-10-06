import { describe, expect, it } from 'vitest';
import { activeDeals, isDealActive } from './deals';

// Local-time constructor, so these don't depend on the test machine's timezone.
const today = new Date(2026, 9, 6, 21, 30); // Oct 6 2026, 9:30pm local

describe('isDealActive', () => {
  it('treats a deal with no dates as always active', () => {
    expect(isDealActive({ description: 'Happy hour' }, today)).toBe(true);
  });

  it('includes the start and end dates themselves', () => {
    expect(isDealActive({ description: 'x', startDate: '2026-10-06' }, today)).toBe(true);
    expect(isDealActive({ description: 'x', endDate: '2026-10-06' }, today)).toBe(true);
  });

  it('excludes deals that have not started or have already ended', () => {
    expect(isDealActive({ description: 'x', startDate: '2026-10-07' }, today)).toBe(false);
    expect(isDealActive({ description: 'x', endDate: '2026-10-05' }, today)).toBe(false);
  });

  it('treats null dates as open-ended', () => {
    expect(isDealActive({ description: 'x', startDate: null, endDate: null }, today)).toBe(true);
  });
});

describe('activeDeals', () => {
  it('returns only active deals, in order', () => {
    const deals = [
      { description: 'expired', endDate: '2026-01-01' },
      { description: 'a' },
      { description: 'upcoming', startDate: '2027-01-01' },
      { description: 'b', startDate: '2026-10-01', endDate: '2026-10-31' }
    ];
    expect(activeDeals(deals, today).map((d) => d.description)).toEqual(['a', 'b']);
  });

  it('handles a missing deals list', () => {
    expect(activeDeals(undefined, today)).toEqual([]);
  });
});
