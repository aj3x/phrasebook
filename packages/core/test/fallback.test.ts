import { describe, expect, test } from 'bun:test';
import { createClient } from '../src/client';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ETag: '"1"' },
  });
}

describe('createClient fallback chain', () => {
  test("fr-CA missing a key falls back to fr, formatted with fr's plural rules", async () => {
    const bundles: Record<string, unknown> = {
      'fr-CA': {
        locale: 'fr-CA',
        namespace: 'common',
        version: 1,
        keys: {
          'home.hero.title': 'Bienvenue (CA)',
          // cart.items intentionally absent, same gap seed.ts creates.
        },
      },
      fr: {
        locale: 'fr',
        namespace: 'common',
        version: 1,
        keys: {
          'home.hero.title': 'Bienvenue',
          'cart.items': '{count, plural, one {# article} other {# articles}}',
        },
      },
      en: {
        locale: 'en',
        namespace: 'common',
        version: 1,
        keys: {
          'home.hero.title': 'Welcome',
          'cart.items': '{count, plural, one {# item} other {# items}}',
        },
      },
    };

    const fetchImpl = async (url: string) => {
      const locale = url.split('/').at(-2);
      return jsonResponse(bundles[locale ?? '']);
    };

    const client = createClient({
      endpoint: 'https://api.example.com',
      project: 'demo',
      namespaces: ['common'],
      defaultLocale: 'en',
      fetchImpl,
    });

    await client.load('fr-CA');

    // Present directly in fr-CA: no fallback needed.
    expect(client.t('home.hero.title')).toBe('Bienvenue (CA)');

    // Missing in fr-CA, present in fr: falls back one level, formatted
    // with French plural rules (not English's).
    expect(client.t('cart.items', { count: 1 })).toBe('1 article');
    expect(client.t('cart.items', { count: 2 })).toBe('2 articles');
  });
});
