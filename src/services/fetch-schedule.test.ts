import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchScheduleCsv } from './fetch-schedule.js';

afterEach(() => vi.unstubAllGlobals());

describe('schedule download', () => {
  it('returns the downloaded schedule', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('game_id,season\nexample,2026')));
    await expect(fetchScheduleCsv()).resolves.toBe('game_id,season\nexample,2026');
  });
  it('explains connection failures and the upload alternative', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(fetchScheduleCsv()).rejects.toMatchObject({ status: 502, message: expect.stringContaining('upload games.csv') });
  });
  it('reports an upstream HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unavailable', { status: 503 })));
    await expect(fetchScheduleCsv()).rejects.toMatchObject({ status: 502, message: expect.stringContaining('HTTP 503') });
  });
  it('rejects oversized responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x'.repeat(5_000_001))));
    await expect(fetchScheduleCsv()).rejects.toMatchObject({ status: 502, message: expect.stringContaining('file size') });
  });
});
