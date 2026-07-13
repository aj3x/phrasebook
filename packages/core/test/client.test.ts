import { describe, expect, test } from 'bun:test';
import { createClient } from '../src/client';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ETag: '"1"' },
    ...init,
  });
}

describe('createClient', () => {
  test('load() fetches the bundle and t() resolves plain keys and ICU plurals', async () => {
    const fetchImpl = async (url: string) => {
      expect(url).toBe('https://api.example.com/v1/runtime/demo/en/common');
      return jsonResponse({
        locale: 'en',
        namespace: 'common',
        version: 1,
        keys: {
          'home.hero.title': 'Welcome',
          'cart.items': 'You have {count, plural, one {# item} other {# items}}',
        },
      });
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
    expect(client.t('cart.items', { count: 1 })).toBe('You have 1 item');
    expect(client.t('cart.items', { count: 3 })).toBe('You have 3 items');
  });
});
