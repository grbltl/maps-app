import { describe, expect, it } from 'vitest';
import { CachingEntityDataConnector } from './CachingEntityDataConnector';
import type { EntityDataOutlet } from '../../core/interfaces/EntityDataOutlet';
import type { Coordinates, Entity } from '../../core/types';

class FakeDataSource implements EntityDataOutlet {
  calls: Array<{ center: Coordinates; radiusMiles: number }> = [];
  failNext = false;

  async findNear(center: Coordinates, radiusMiles: number): Promise<Entity[]> {
    this.calls.push({ center, radiusMiles });
    if (this.failNext) {
      this.failNext = false;
      throw new Error('backend down');
    }
    return [{ name: `near ${center.lat}`, coordinates: center }];
  }
}

const charlotte = { lat: 35.227, lng: -80.843 };
// ~3.5 mi north: a 5-mi circle here lies inside a 10-mi area around charlotte
// (3.5 + 5 <= 10).
const nearby = { lat: 35.277, lng: -80.843 };
// ~7 mi north: 7 + 5 > 10, so it needs a new fetch.
const farther = { lat: 35.328, lng: -80.843 };

describe('CachingEntityDataConnector', () => {
  it('fetches a wider area than asked', async () => {
    const inner = new FakeDataSource();
    await new CachingEntityDataConnector(inner).findNear(charlotte, 5);
    expect(inner.calls).toEqual([{ center: charlotte, radiusMiles: 10 }]);
  });

  it('answers a search inside an already-fetched area from memory', async () => {
    const inner = new FakeDataSource();
    const cache = new CachingEntityDataConnector(inner);
    const first = await cache.findNear(charlotte, 5);
    expect(await cache.findNear(nearby, 5)).toBe(first);
    expect(inner.calls).toHaveLength(1);
  });

  it('fetches again once the circle pokes outside every fetched area', async () => {
    const inner = new FakeDataSource();
    const cache = new CachingEntityDataConnector(inner);
    await cache.findNear(charlotte, 5);
    await cache.findNear(farther, 5);
    expect(inner.calls.map((call) => call.center)).toEqual([charlotte, farther]);
  });

  it('shares one request between overlapping calls', async () => {
    const inner = new FakeDataSource();
    const cache = new CachingEntityDataConnector(inner);
    await Promise.all([cache.findNear(charlotte, 5), cache.findNear(nearby, 5)]);
    expect(inner.calls).toHaveLength(1);
  });

  it('forgets a failed fetch so the next search retries', async () => {
    const inner = new FakeDataSource();
    inner.failNext = true;
    const cache = new CachingEntityDataConnector(inner);
    await expect(cache.findNear(charlotte, 5)).rejects.toThrow('backend down');
    await cache.findNear(charlotte, 5);
    expect(inner.calls).toHaveLength(2);
  });

  it('keeps only the most recently used areas', async () => {
    const inner = new FakeDataSource();
    const cache = new CachingEntityDataConnector(inner, 2, 1);
    await cache.findNear(charlotte, 5);
    await cache.findNear(farther, 5);
    await cache.findNear(charlotte, 5);
    expect(inner.calls).toHaveLength(3);
  });
});
