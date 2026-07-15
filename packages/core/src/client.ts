import { format } from '@phrasebook/icu';
import type { FormatValues } from '@phrasebook/icu';
import { TranslationBundle } from '@phrasebook/schemas';
import { deriveFallbackChain } from './fallback-chain';

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<Response>;

export interface CreateClientOptions {
  endpoint: string;
  project: string;
  namespaces: string[];
  defaultLocale: string;
  fallbackChain?: Record<string, string[]>;
  fetchImpl?: FetchLike;
  dev?: boolean;
  /**
   * Per-request timeout in ms. A silent hang (transport that never resolves
   * -- proxy black-holing the connection, misconfigured DNS, etc.) would
   * otherwise leave load() pending forever; instead we abort after this
   * many ms, the surrounding try/catch swallows the AbortError, and the
   * SDK keeps serving whatever's cached (M1 DoD #6). Defaults to 10s.
   */
  timeoutMs?: number;
  /**
   * Upper bound on how many (locale, namespace) bundles are kept in memory
   * before the least-recently-used one is evicted. Matters mainly for
   * long-lived server processes doing SSR across many locales, where an
   * unbounded cache would otherwise leak. Defaults to 50 bundles; set 0
   * to disable eviction entirely.
   */
  maxCachedBundles?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_CACHED_BUNDLES = 50;

export interface Client {
  load(locale: string): Promise<void>;
  t(key: string, values?: FormatValues): string;
  resolvedLocale(key: string): string | undefined;
}

interface CacheEntry {
  version: number;
  etag: string;
  keys: Record<string, string>;
}

export function createClient(options: CreateClientOptions): Client {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxCachedBundles = options.maxCachedBundles ?? DEFAULT_MAX_CACHED_BUNDLES;
  // Insertion-ordered Map doubles as an LRU: touchCache() re-inserts on
  // access to move an entry to the tail, and putCache() evicts from the
  // head once we're over maxCachedBundles. maxCachedBundles=0 disables.
  const cache = new Map<string, CacheEntry>();
  let currentLocale = options.defaultLocale;

  function cacheKey(locale: string, namespace: string): string {
    return `${locale}:${namespace}`;
  }

  function getCache(key: string): CacheEntry | undefined {
    const entry = cache.get(key);
    if (entry && maxCachedBundles > 0) {
      cache.delete(key);
      cache.set(key, entry);
    }
    return entry;
  }

  function putCache(key: string, entry: CacheEntry): void {
    cache.delete(key);
    cache.set(key, entry);
    if (maxCachedBundles > 0) {
      while (cache.size > maxCachedBundles) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
    }
  }

  async function fetchBundle(locale: string, namespace: string): Promise<void> {
    const url = `${options.endpoint}/v1/runtime/${options.project}/${locale}/${namespace}`;
    const key = cacheKey(locale, namespace);
    const cached = getCache(key);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = cached ? { 'If-None-Match': cached.etag } : undefined;
      const res = await fetchImpl(url, { headers, signal: controller.signal });

      if (res.status === 304) {
        // Unchanged -- the cached entry is still current, nothing to update.
        return;
      }

      if (!res.ok) {
        throw new Error(`Unexpected status ${res.status} fetching ${url}`);
      }

      const json = await res.json();
      const bundle = TranslationBundle.parse(json);
      putCache(key, {
        version: bundle.version,
        etag: res.headers.get('ETag') ?? '',
        keys: bundle.keys,
      });
    } catch (err) {
      // Never let a network hiccup or a down server surface as an error UI
      // (M1 DoD #6) -- keep serving whatever is already cached, if anything.
      if (options.dev) {
        console.warn(`[phrasebook] failed to fetch ${url}, using cached bundle if any:`, err);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  function resolve(key: string): { locale: string; source: string } | undefined {
    const chain = deriveFallbackChain(currentLocale, options.defaultLocale, options.fallbackChain);

    for (const chainLocale of chain) {
      for (const namespace of options.namespaces) {
        const entry = getCache(cacheKey(chainLocale, namespace));
        const source = entry?.keys[key];
        if (source !== undefined) {
          return { locale: chainLocale, source };
        }
      }
    }

    return undefined;
  }

  return {
    async load(locale: string): Promise<void> {
      currentLocale = locale;
      const chain = deriveFallbackChain(locale, options.defaultLocale, options.fallbackChain);

      await Promise.all(
        chain.flatMap((chainLocale) =>
          options.namespaces.map((namespace) => fetchBundle(chainLocale, namespace)),
        ),
      );
    },

    t(key: string, values?: FormatValues): string {
      const match = resolve(key);
      if (match) {
        return format(match.source, match.locale, values);
      }

      if (options.dev) {
        const chain = deriveFallbackChain(
          currentLocale,
          options.defaultLocale,
          options.fallbackChain,
        );
        console.warn(
          `[phrasebook] no translation for "${key}" in any locale of the fallback chain [${chain.join(', ')}], falling back to the key itself`,
        );
      }

      return key;
    },

    resolvedLocale(key: string): string | undefined {
      return resolve(key)?.locale;
    },
  };
}
