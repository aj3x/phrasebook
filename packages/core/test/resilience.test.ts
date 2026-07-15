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

  test('a fetch that never resolves is aborted by timeoutMs, keeping load() bounded', async () => {
    const fetchImpl = (_url: string, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });

    const client = createClient({
      endpoint: 'https://api.example.com',
      project: 'demo',
      namespaces: ['common'],
      defaultLocale: 'en',
      timeoutMs: 10,
      fetchImpl,
    });

    const start = Date.now();
    await expect(client.load('en')).resolves.toBeUndefined();
    // The abort should fire well under a full second; give a generous
    // margin for slow CI without letting a regression to "no timeout"
    // pass (which would hang forever, tripping the test framework's
    // own timeout).
    expect(Date.now() - start).toBeLessThan(500);
    expect(client.t('home.hero.title')).toBe('home.hero.title');
  });

  test('evicts the least-recently-used bundle once maxCachedBundles is exceeded, and refetches on next use', async () => {
    // One bundle per locale, each carrying a locale-specific greeting so we
    // can tell which one is currently cached. maxCachedBundles: 1 forces
    // the cache to hold at most one entry -- after loading 'fr' then 'de',
    // 'en' has been evicted, so the next load('en') must re-hit fetchImpl.
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      const locale = url.split('/').at(-2) ?? 'en';
      return jsonResponse({
        locale,
        namespace: 'common',
        version: 1,
        keys: { greeting: `hello-${locale}` },
      });
    };

    const client = createClient({
      endpoint: 'https://api.example.com',
      project: 'demo',
      namespaces: ['common'],
      defaultLocale: 'en',
      maxCachedBundles: 1,
      // Pin each locale's chain to itself so a miss on 'en' can't be
      // satisfied by another locale's bundle -- we want to observe the
      // refetch itself, not a cross-locale fallback hit.
      fallbackChain: { en: ['en'], fr: ['fr'], de: ['de'] },
      fetchImpl,
    });

    await client.load('en');
    await client.load('fr');
    await client.load('de');
    expect(calls).toHaveLength(3);

    // 'en' was evicted after 'fr' loaded, so this must trigger another fetch.
    await client.load('en');
    expect(calls).toHaveLength(4);
    expect(client.t('greeting')).toBe('hello-en');
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
