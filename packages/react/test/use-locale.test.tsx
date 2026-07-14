import type { Client } from '@phrasebook/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { PhrasebookProvider, useLocale } from '../src';

function LocaleSwitcher() {
  const [locale, setLocale] = useLocale();
  return (
    <div>
      <p>Current: {locale}</p>
      <button type="button" onClick={() => setLocale('fr')}>
        Switch to French
      </button>
    </div>
  );
}

describe('useLocale', () => {
  test('reflects the current locale and calls onLocaleChange when set', async () => {
    const client: Client = {
      load: async () => {},
      t: (key) => key,
      resolvedLocale: () => undefined,
    };
    const onLocaleChange = vi.fn();

    render(
      <Suspense fallback={null}>
        <PhrasebookProvider client={client} locale="en" onLocaleChange={onLocaleChange}>
          <LocaleSwitcher />
        </PhrasebookProvider>
      </Suspense>,
    );

    await screen.findByText('Current: en');

    fireEvent.click(screen.getByText('Switch to French'));

    expect(onLocaleChange).toHaveBeenCalledWith('fr');
  });
});
