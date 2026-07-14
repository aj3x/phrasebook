import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { ProjectPicker } from '../src/ProjectPicker';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('ProjectPicker', () => {
  test('renders the accessible projects once loaded', async () => {
    const fetchImpl = async () =>
      jsonResponse({
        projects: [
          { name: 'demo', sourceLocale: 'en' },
          { name: 'other', sourceLocale: 'en' },
        ],
      });

    renderWithQueryClient(
      <ProjectPicker
        endpoint="https://api.example.com"
        onSignOut={() => {}}
        onSelectProject={() => {}}
        fetchImpl={fetchImpl}
      />,
    );

    screen.getByText(/loading projects/i);

    await waitFor(() => {
      screen.getByText('demo (source: en)');
      screen.getByText('other (source: en)');
    });
  });

  test('shows an empty-state message when the user has no accessible projects', async () => {
    const fetchImpl = async () => jsonResponse({ projects: [] });

    renderWithQueryClient(
      <ProjectPicker
        endpoint="https://api.example.com"
        onSignOut={() => {}}
        onSelectProject={() => {}}
        fetchImpl={fetchImpl}
      />,
    );

    await waitFor(() => {
      screen.getByText(/no projects available/i);
    });
  });

  test('shows an error message when the request fails', async () => {
    const fetchImpl = async () => new Response('', { status: 500 });

    renderWithQueryClient(
      <ProjectPicker
        endpoint="https://api.example.com"
        onSignOut={() => {}}
        onSelectProject={() => {}}
        fetchImpl={fetchImpl}
      />,
    );

    await waitFor(() => {
      screen.getByRole('alert');
    });
  });

  test('calls onSignOut when the sign out button is clicked', async () => {
    const fetchImpl = async () => jsonResponse({ projects: [] });
    const onSignOut = vi.fn();

    renderWithQueryClient(
      <ProjectPicker
        endpoint="https://api.example.com"
        onSignOut={onSignOut}
        onSelectProject={() => {}}
        fetchImpl={fetchImpl}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    expect(onSignOut).toHaveBeenCalledOnce();
  });

  test('calls onSelectProject with the project name when a project is clicked', async () => {
    const fetchImpl = async () =>
      jsonResponse({ projects: [{ name: 'demo', sourceLocale: 'en' }] });
    const onSelectProject = vi.fn();

    renderWithQueryClient(
      <ProjectPicker
        endpoint="https://api.example.com"
        onSignOut={() => {}}
        onSelectProject={onSelectProject}
        fetchImpl={fetchImpl}
      />,
    );

    await waitFor(() => screen.getByText('demo (source: en)'));
    fireEvent.click(screen.getByRole('button', { name: /demo \(source: en\)/i }));

    expect(onSelectProject).toHaveBeenCalledWith('demo');
  });
});
