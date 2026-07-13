import { describe, expect, spyOn, test } from 'bun:test';
import { createClient } from '../src/client';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ETag: '"1"' },
  });
}

describe('createClient resilience', () => {
  test('load() does not throw when the fetch fails, and t() falls back to the key', async () => {
    const fetchImpl = async (): Promise<Response> => {
      throw new Error('network down');
    };

    const client = createClient({
      endpoint: 'https://api.example.com',
      project: 'demo',
      namespaces: ['common'],
      defaultLocale: 'en',
      fetchImpl,
    });

    await expect(client.load('en')).resolves.toBeUndefined();
    expect(client.t('home.hero.title')).toBe('home.hero.title');
  });

  test('a failed re-fetch keeps serving the previously cached bundle (M1 DoD #6)', async () => {
    let callCount = 0;
    const fetchImpl = async (): Promise<Response> => {
      callCount += 1;
      if (callCount === 1) {
        return jsonResponse({
          locale: 'en',
          namespace: 'common',
          version: 1,
          keys: { 'home.hero.title': 'Welcome' },
        });
      }
      throw new Error('server killed');
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

    // Server is down now; load() must not throw, and the stale-but-cached
    // bundle should still render instead of an error UI.
    await expect(client.load('en')).resolves.toBeUndefined();
    expect(client.t('home.hero.title')).toBe('Welcome');
  });

  test('a key missing from every locale in the chain returns the raw key and warns in dev mode', async () => {
    const fetchImpl = async () =>
      jsonResponse({ locale: 'en', namespace: 'common', version: 1, keys: {} });

    const warn = spyOn(console, 'warn').mockImplementation(() => {});

    const client = createClient({
      endpoint: 'https://api.example.com',
      project: 'demo',
      namespaces: ['common'],
      defaultLocale: 'en',
      dev: true,
      fetchImpl,
    });

    await client.load('en');
    expect(client.t('no.such.key')).toBe('no.such.key');
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });
});
