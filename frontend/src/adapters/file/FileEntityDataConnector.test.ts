import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileEntityDataConnector, toEntity } from './FileEntityDataConnector';

const center = { lat: 35.2, lng: -80.8 };

describe('toEntity', () => {
  it('maps a record to an Entity with a two-line US address', () => {
    const entity = toEntity({
      name: 'ARDENTE KITCHEN',
      lat: 35.21,
      lng: -80.85,
      street: '500 E MOREHEAD ST',
      unit: 'SUITE 100',
      city: 'CHARLOTTE',
      state: 'NC',
      zip: '28202'
    });
    expect(entity).toEqual({
      name: 'ARDENTE KITCHEN',
      coordinates: { lat: 35.21, lng: -80.85 },
      details: { address: ['500 E MOREHEAD ST SUITE 100', 'CHARLOTTE, NC 28202'] }
    });
  });

  it('leaves details out when the record has no address', () => {
    expect(toEntity({ name: 'X', lat: 1, lng: 2 }).details).toBeUndefined();
  });
});

describe('FileEntityDataConnector', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches the file once and reuses it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ name: 'A', lat: 1, lng: 2 }]), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
    const connector = new FileEntityDataConnector('/data.json');

    expect((await connector.findNear(center, 5)).map((e) => e.name)).toEqual(['A']);
    await connector.findNear(center, 5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/data.json');
  });

  it('rejects on HTTP errors and retries on the next call', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const connector = new FileEntityDataConnector();

    await expect(connector.findNear(center, 5)).rejects.toThrow('HTTP 404');
    await expect(connector.findNear(center, 5)).resolves.toEqual([]);
  });
});
