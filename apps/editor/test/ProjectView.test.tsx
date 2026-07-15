import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { ProjectView } from '../src/ProjectView';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const DETAIL = {
  name: 'demo',
  sourceLocale: 'en',
  locales: ['fr', 'es'],
  namespaces: ['common'],
  autoApprove: true,
};
const KEYS = [
  { key: 'home.hero.title', sourceText: 'Welcome', targetText: 'Bienvenue', status: 'approved' },
];

function createRoutingFetchImpl(requests: string[]) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    requests.push(url);
    if (init?.method === 'PUT') {
      return jsonResponse({ status: 'needs_review' });
    }
    if (url.includes('/keys')) {
      return jsonResponse({ keys: KEYS });
    }
    return jsonResponse(DETAIL);
  };
}

describe('ProjectView', () => {
  test('loads project detail, defaults to the first namespace/locale, and shows the key list', async () => {
    const requests: string[] = [];
    const fetchImpl = createRoutingFetchImpl(requests);

    renderWithQueryClient(
      <ProjectView
        endpoint="https://api.example.com"
        project="demo"
        onBack={() => {}}
        fetchImpl={fetchImpl}
      />,
    );

    await waitFor(() => {
      screen.getByText('home.hero.title');
    });

    expect((screen.getByLabelText(/namespace/i) as HTMLSelectElement).value).toBe('common');
    expect((screen.getByLabelText(/locale/i) as HTMLSelectElement).value).toBe('fr');

    const keysRequest = requests.find((r) => r.includes('/keys'));
    expect(keysRequest).toContain('namespace=common');
    expect(keysRequest).toContain('locale=fr');
  });

  test('re-fetches keys with the new locale when the locale selector changes', async () => {
    const requests: string[] = [];
    const fetchImpl = createRoutingFetchImpl(requests);

    renderWithQueryClient(
      <ProjectView
        endpoint="https://api.example.com"
        project="demo"
        onBack={() => {}}
        fetchImpl={fetchImpl}
      />,
    );

    await waitFor(() => screen.getByText('home.hero.title'));

    fireEvent.change(screen.getByLabelText(/locale/i), { target: { value: 'es' } });

    await waitFor(() => {
      const keysRequests = requests.filter((r) => r.includes('/keys'));
      expect(keysRequests.some((r) => r.includes('locale=es'))).toBe(true);
    });
  });

  test('adds a status query param when the status filter is changed', async () => {
    const requests: string[] = [];
    const fetchImpl = createRoutingFetchImpl(requests);

    renderWithQueryClient(
      <ProjectView
        endpoint="https://api.example.com"
        project="demo"
        onBack={() => {}}
        fetchImpl={fetchImpl}
      />,
    );

    await waitFor(() => screen.getByText('home.hero.title'));

    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: 'approved' } });

    await waitFor(() => {
      const keysRequests = requests.filter((r) => r.includes('/keys'));
      expect(keysRequests.some((r) => r.includes('status=approved'))).toBe(true);
    });
  });

  test('editing and saving a translation PUTs to the save endpoint and shows the reconciled status', async () => {
    const requests: string[] = [];
    const fetchImpl = createRoutingFetchImpl(requests);

    renderWithQueryClient(
      <ProjectView
        endpoint="https://api.example.com"
        project="demo"
        onBack={() => {}}
        fetchImpl={fetchImpl}
      />,
    );

    await waitFor(() => screen.getByText('home.hero.title'));

    fireEvent.doubleClick(screen.getByText('Bienvenue'));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Bienvenue !' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.queryByRole('textbox')).toBeNull();
      screen.getByText('Bienvenue !');
      screen.getByRole('cell', { name: 'needs review' });
    });

    const saveRequest = requests.find((r) => r.includes('/translations/'));
    expect(saveRequest).toContain('/v1/projects/demo/translations/common/fr/home.hero.title');
  });

  test('calls onBack when the back button is clicked', async () => {
    const fetchImpl = createRoutingFetchImpl([]);
    const onBack = vi.fn();

    renderWithQueryClient(
      <ProjectView
        endpoint="https://api.example.com"
        project="demo"
        onBack={onBack}
        fetchImpl={fetchImpl}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /projects/i }));

    expect(onBack).toHaveBeenCalledOnce();
  });

  test('toggling auto-approve PATCHes the settings endpoint with the new value', async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url, method, body });
      if (method === 'PATCH') return jsonResponse(body);
      if (url.includes('/keys')) return jsonResponse({ keys: KEYS });
      return jsonResponse(DETAIL);
    };

    renderWithQueryClient(
      <ProjectView
        endpoint="https://api.example.com"
        project="demo"
        onBack={() => {}}
        fetchImpl={fetchImpl}
      />,
    );

    const checkbox = await screen.findByLabelText(/auto-approve/i);
    expect(checkbox).toHaveProperty('checked', true);

    fireEvent.click(checkbox);

    await waitFor(() => {
      const patch = calls.find((c) => c.method === 'PATCH');
      expect(patch).toBeDefined();
      expect(patch?.url).toContain('/v1/projects/demo/settings');
      expect(patch?.body).toEqual({ autoApprove: false });
    });
    // Optimistically reflects the new state.
    expect(checkbox).toHaveProperty('checked', false);
  });

  test('claiming a row POSTs to the claim endpoint', async () => {
    const calls: { url: string; method: string }[] = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      if (url.endsWith('/claim')) return jsonResponse({ status: 'in_review' });
      if (url.includes('/keys')) {
        return jsonResponse({
          keys: [
            {
              key: 'home.hero.title',
              sourceText: 'Welcome',
              targetText: '',
              status: 'needs_review',
            },
          ],
        });
      }
      return jsonResponse(DETAIL);
    };

    renderWithQueryClient(
      <ProjectView
        endpoint="https://api.example.com"
        project="demo"
        onBack={() => {}}
        fetchImpl={fetchImpl}
      />,
    );

    await waitFor(() => screen.getByText('home.hero.title'));
    fireEvent.click(screen.getByRole('button', { name: /claim/i }));

    await waitFor(() => {
      const claim = calls.find((c) => c.url.endsWith('/claim'));
      expect(claim).toBeDefined();
      expect(claim?.url).toContain(
        '/v1/projects/demo/translations/common/fr/home.hero.title/claim',
      );
      expect(claim?.method).toBe('POST');
    });
  });
});
