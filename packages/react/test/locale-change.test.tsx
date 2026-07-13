import type { Client } from '@phrasebook/core';
import { render, screen, waitFor } from '@testing-library/react';
import { Suspense } from 'react';
import { describe, expect, test } from 'vitest';
import { PhrasebookProvider, useT } from '../src';

function Title() {
  const t = useT();
  return <h1>{t('home.hero.title')}</h1>;
}

describe('locale changes', () => {
  test('changing the locale prop re-suspends and loads the new locale', async () => {
    const text: Record<string, string> = { en: 'Welcome', fr: 'Bienvenue' };
    const resolvers = new Map<string, () => void>();
    const loadCalls: string[] = [];

    const client: Client = {
      load: (locale) => {
        loadCalls.push(locale);
        return new Promise<void>((resolve) => {
          resolvers.set(locale, resolve);
        });
      },
      t: (key, values) => {
        // Only one key is used in this test; return this render's active
        // locale's text via the closure below.
        void values;
        return key;
      },
    };
    // Override t() per-locale after the fact isn't possible via closures
    // above cleanly, so resolve it with a tiny lookup keyed by whichever
    // locale most recently finished loading.
    let activeLocale = 'en';
    client.t = (key) => (key === 'home.hero.title' ? (text[activeLocale] ?? key) : key);

    const { rerender } = render(
      <Suspense fallback={<p>Loading...</p>}>
        <PhrasebookProvider client={client} locale="en">
          <Title />
        </PhrasebookProvider>
      </Suspense>,
    );

    screen.getByText('Loading...');
    resolvers.get('en')?.();
    activeLocale = 'en';
    await waitFor(() => screen.getByText('Welcome'));

    rerender(
      <Suspense fallback={<p>Loading...</p>}>
        <PhrasebookProvider client={client} locale="fr">
          <Title />
        </PhrasebookProvider>
      </Suspense>,
    );

    screen.getByText('Loading...');
    activeLocale = 'fr';
    resolvers.get('fr')?.();
    await waitFor(() => screen.getByText('Bienvenue'));

    expect(loadCalls).toEqual(['en', 'fr']);
  });
});
