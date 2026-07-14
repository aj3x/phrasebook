import { format } from '@phrasebook/icu';
import type { FormatValues } from '@phrasebook/icu';
import { TranslationBundle } from '@phrasebook/schemas';
import { deriveFallbackChain } from './fallback-chain';

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<Response>;

export interface CreateClientOptions {
  endpoint: string;
  project: string;
  namespaces: string[];
  defaultLocale: string;
  fallbackChain?: Record<string, string[]>;
  fetchImpl?: FetchLike;
  dev?: boolean;
}

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
  const cache = new Map<string, CacheEntry>();
  let currentLocale = options.defaultLocale;

  function cacheKey(locale: string, namespace: string): string {
    return `${locale}:${namespace}`;
  }

  async function fetchBundle(locale: string, namespace: string): Promise<void> {
    const url = `${options.endpoint}/v1/runtime/${options.project}/${locale}/${namespace}`;
    const cached = cache.get(cacheKey(locale, namespace));

    try {
      const res = await fetchImpl(
        url,
        cached ? { headers: { 'If-None-Match': cached.etag } } : undefined,
      );

      if (res.status === 304) {
        // Unchanged -- the cached entry is still current, nothing to update.
        return;
      }

      if (!res.ok) {
        throw new Error(`Unexpected status ${res.status} fetching ${url}`);
      }

      const json = await res.json();
      const bundle = TranslationBundle.parse(json);
      cache.set(cacheKey(locale, namespace), {
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
    }
  }

  function resolve(key: string): { locale: string; source: string } | undefined {
    const chain = deriveFallbackChain(currentLocale, options.defaultLocale, options.fallbackChain);

    for (const chainLocale of chain) {
      for (const namespace of options.namespaces) {
        const entry = cache.get(cacheKey(chainLocale, namespace));
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
