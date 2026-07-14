import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, test } from 'vitest';
import { App } from '../src/App';
import { createFakeAuthClient } from './fake-auth-client';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

const fetchImpl = async () => jsonResponse({ projects: [{ name: 'demo', sourceLocale: 'en' }] });

async function routingFetchImpl(input: RequestInfo | URL) {
  const url = typeof input === 'string' ? input : input.toString();
  if (url.includes('/keys')) {
    return jsonResponse({
      keys: [
        {
          key: 'home.hero.title',
          sourceText: 'Welcome',
          targetText: 'Bienvenue',
          status: 'approved',
        },
      ],
    });
  }
  if (/\/v1\/projects\/[^/]+$/.test(url)) {
    return jsonResponse({
      name: 'demo',
      sourceLocale: 'en',
      locales: ['fr'],
      namespaces: ['common'],
    });
  }
  return jsonResponse({ projects: [{ name: 'demo', sourceLocale: 'en' }] });
}

describe('App', () => {
  test('shows the login screen when there is no session', () => {
    const authClient = createFakeAuthClient();
    render(
      <App authClient={authClient} endpoint="https://api.example.com" fetchImpl={fetchImpl} />,
    );

    screen.getByRole('button', { name: /sign in/i });
  });

  test('shows the project picker after a successful sign-in', async () => {
    const authClient = createFakeAuthClient();
    render(
      <App authClient={authClient} endpoint="https://api.example.com" fetchImpl={fetchImpl} />,
    );

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'admin@phrasebook.local' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'correct-horse-battery-staple' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      screen.getByText('demo (source: en)');
    });
  });

  test('shows the login screen again after signing out', async () => {
    const authClient = createFakeAuthClient('admin@phrasebook.local');
    render(
      <App authClient={authClient} endpoint="https://api.example.com" fetchImpl={fetchImpl} />,
    );

    await waitFor(() => screen.getByText('demo (source: en)'));

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    await waitFor(() => {
      screen.getByRole('button', { name: /sign in/i });
    });
  });

  test('selecting a project shows its key list', async () => {
    const authClient = createFakeAuthClient('admin@phrasebook.local');
    render(
      <App
        authClient={authClient}
        endpoint="https://api.example.com"
        fetchImpl={routingFetchImpl}
      />,
    );

    await waitFor(() => screen.getByText('demo (source: en)'));
    fireEvent.click(screen.getByRole('button', { name: /demo \(source: en\)/i }));

    await waitFor(() => {
      screen.getByText('home.hero.title');
      screen.getByText('Bienvenue');
    });
  });
});
