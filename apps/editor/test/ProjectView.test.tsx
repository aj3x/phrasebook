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

const DETAIL = { name: 'demo', sourceLocale: 'en', locales: ['fr', 'es'], namespaces: ['common'] };
const KEYS = [
  { key: 'home.hero.title', sourceText: 'Welcome', targetText: 'Bienvenue', status: 'approved' },
];

function createRoutingFetchImpl(requests: string[]) {
  return async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    requests.push(url);
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
});
