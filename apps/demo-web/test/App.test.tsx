import { createClient } from '@phrasebook/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, test } from 'vitest';
import { App } from '../src/App';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ETag: '"1"' },
  });
}

const bundles: Record<string, unknown> = {
  en: {
    locale: 'en',
    namespace: 'common',
    version: 1,
    keys: {
      'home.hero.title': 'Welcome',
      'home.hero.subtitle': 'Manage your translations with ease',
      'cart.items': 'You have {count, plural, one {# item} other {# items}}',
    },
  },
  fr: {
    locale: 'fr',
    namespace: 'common',
    version: 1,
    keys: {
      'home.hero.title': 'Bienvenue',
      'home.hero.subtitle': 'Gérez vos traductions facilement',
      'cart.items': 'Vous avez {count, plural, one {# article} other {# articles}}',
    },
  },
  'fr-CA': {
    locale: 'fr-CA',
    namespace: 'common',
    version: 1,
    keys: {
      'home.hero.title': 'Bienvenue',
      'home.hero.subtitle': 'Gérez vos traductions facilement',
      // cart.items intentionally absent, same gap seed.ts creates.
    },
  },
  es: {
    locale: 'es',
    namespace: 'common',
    version: 1,
    keys: {
      'home.hero.title': 'Bienvenido',
      'home.hero.subtitle': 'Gestiona tus traducciones con facilidad',
      'cart.items': 'Tienes {count, plural, one {# artículo} other {# artículos}}',
    },
  },
};

function createTestClient() {
  return createClient({
    endpoint: 'https://api.example.com',
    project: 'demo',
    namespaces: ['common'],
    defaultLocale: 'en',
    fetchImpl: async (url) => {
      const locale = url.split('/').at(-2);
      return jsonResponse(bundles[locale ?? '']);
    },
  });
}

describe('App', () => {
  test('renders the three seeded keys for the default locale, with debug info', async () => {
    const client = createTestClient();

    render(
      <App client={client} endpoint="https://api.example.com" project="demo" namespace="common" />,
    );

    await waitFor(() => {
      screen.getByText('Welcome');
      screen.getByText('Manage your translations with ease');
      screen.getByText('You have 1 item');
    });

    screen.getByText('Requested locale: en', { exact: false });
    screen.getByText('https://api.example.com/v1/runtime/demo/en/common', { exact: false });
  });

  test('switching to fr-CA falls back to fr for the plural key, proving the fallback chain', async () => {
    const client = createTestClient();

    render(
      <App client={client} endpoint="https://api.example.com" project="demo" namespace="common" />,
    );

    await waitFor(() => screen.getByText('Welcome'));

    fireEvent.change(screen.getByLabelText(/locale/i), { target: { value: 'fr-CA' } });

    await waitFor(() => {
      // Direct hit in fr-CA.
      screen.getByText('Bienvenue');
      // Missing in fr-CA, falls back to fr.
      screen.getByText('Vous avez 1 article');
    });
  });

  test('changing the item count updates the rendered plural', async () => {
    const client = createTestClient();

    render(
      <App client={client} endpoint="https://api.example.com" project="demo" namespace="common" />,
    );

    await waitFor(() => screen.getByText('You have 1 item'));

    fireEvent.change(screen.getByLabelText(/item count/i), { target: { value: '5' } });

    await waitFor(() => screen.getByText('You have 5 items'));
  });
});
