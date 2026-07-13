import { createClient } from '@phrasebook/core';
import { render, screen, waitFor } from '@testing-library/react';
import { Suspense } from 'react';
import { describe, test } from 'vitest';
import { PhrasebookProvider, useT } from '../src';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ETag: '"1"' },
  });
}

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

function Cart() {
  const t = useT();
  return (
    <div>
      <h1>{t('home.hero.title')}</h1>
      <p>{t('cart.items', { count: 2 })}</p>
    </div>
  );
}

describe('useT through PhrasebookProvider', () => {
  test('renders an ICU plural, and falls back fr-CA -> fr for a missing key', async () => {
    const client = createClient({
      endpoint: 'https://api.example.com',
      project: 'demo',
      namespaces: ['common'],
      defaultLocale: 'en',
      fetchImpl: async (url) => {
        const locale = url.split('/').at(-2);
        return jsonResponse(bundles[locale ?? '']);
      },
    });

    render(
      <Suspense fallback={<p>Loading...</p>}>
        <PhrasebookProvider client={client} locale="fr-CA">
          <Cart />
        </PhrasebookProvider>
      </Suspense>,
    );

    await waitFor(() => {
      // Present directly in fr-CA.
      screen.getByText('Bienvenue (CA)');
      // Missing in fr-CA, falls back to fr, formatted with French plural rules.
      screen.getByText('2 articles');
    });
  });
});
