import { describe, expect, test } from 'bun:test';
import { createClient } from '../src/client';

describe('createClient ETag revalidation', () => {
  test('sends If-None-Match on a re-fetch and reuses the cached bundle on 304', async () => {
    let callCount = 0;
    const fetchImpl = async (url: string, init?: { headers?: Record<string, string> }) => {
      callCount += 1;
      expect(url).toBe('https://api.example.com/v1/runtime/demo/en/common');

      if (callCount === 1) {
        expect(init?.headers?.['If-None-Match']).toBeUndefined();
        return new Response(
          JSON.stringify({
            locale: 'en',
            namespace: 'common',
            version: 1,
            keys: { 'home.hero.title': 'Welcome' },
          }),
          { status: 200, headers: { ETag: '"1"' } },
        );
      }

      expect(init?.headers?.['If-None-Match']).toBe('"1"');
      return new Response(null, { status: 304 });
    };

    const client = createClient({
      endpoint: 'https://api.example.com',
      project: 'demo',
      namespaces: ['common'],
      defaultLocale: 'en',
      fetchImpl,
    });

    await client.load('en');
    expect(client.t('home.hero.title')).toBe('Welcome');

    await client.load('en');
    expect(callCount).toBe(2);
    // 304 meant "unchanged" -- the cached bundle is still there and usable.
    expect(client.t('home.hero.title')).toBe('Welcome');
  });
});
