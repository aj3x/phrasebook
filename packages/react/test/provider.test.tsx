import type { Client } from '@phrasebook/core';
import { render, screen, waitFor } from '@testing-library/react';
import { Suspense } from 'react';
import { describe, test } from 'vitest';
import { PhrasebookProvider, useT } from '../src';

function Title() {
  const t = useT();
  return <h1>{t('home.hero.title')}</h1>;
}

describe('PhrasebookProvider + useT', () => {
  test('suspends until load() resolves, then renders the translated text', async () => {
    let resolveLoad: () => void = () => {};
    const loadPromise = new Promise<void>((resolve) => {
      resolveLoad = resolve;
    });

    const client: Client = {
      load: () => loadPromise,
      t: (key) => (key === 'home.hero.title' ? 'Welcome' : key),
    };

    render(
      <Suspense fallback={<p>Loading...</p>}>
        <PhrasebookProvider client={client} locale="en">
          <Title />
        </PhrasebookProvider>
      </Suspense>,
    );

    screen.getByText('Loading...');

    resolveLoad();

    await waitFor(() => {
      screen.getByText('Welcome');
    });
  });
});
