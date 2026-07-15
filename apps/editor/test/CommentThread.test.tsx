import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { CommentThread } from '../src/CommentThread';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function renderThread(fetchImpl: typeof fetch) {
  return renderWithQueryClient(
    <CommentThread
      endpoint="https://api.example.com"
      project="demo"
      namespace="common"
      locale="fr"
      commentKey="home.hero.title"
      fetchImpl={fetchImpl}
    />,
  );
}

describe('CommentThread', () => {
  test('renders each comment with its author and body', async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        comments: [
          {
            id: '1',
            body: 'Please use the informal register.',
            authorEmail: 'rex@example.com',
            createdAt: '2026-07-15T00:00:00.000Z',
          },
        ],
      })) as unknown as typeof fetch;

    renderThread(fetchImpl);

    await waitFor(() => {
      screen.getByText('Please use the informal register.');
      screen.getByText(/rex@example.com/);
    });
  });

  test('shows an empty-state message when there are no comments', async () => {
    const fetchImpl = (async () => jsonResponse({ comments: [] })) as unknown as typeof fetch;

    renderThread(fetchImpl);

    await waitFor(() => {
      screen.getByText(/no comments yet/i);
    });
  });

  test('posting a comment sends it to the endpoint and refetches the thread', async () => {
    const posted: string[] = [];
    let comments: unknown[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(init.body as string) as { body: string };
        posted.push(body.body);
        const created = {
          id: '9',
          body: body.body,
          authorEmail: 'me@example.com',
          createdAt: '2026-07-15T01:00:00.000Z',
        };
        comments = [created];
        return jsonResponse({ comment: created }, 201);
      }
      return jsonResponse({ comments });
    }) as unknown as typeof fetch;

    renderThread(fetchImpl);

    await waitFor(() => screen.getByText(/no comments yet/i));

    fireEvent.change(screen.getByLabelText(/add a comment/i), {
      target: { value: 'How about a screenshot?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /post/i }));

    await waitFor(() => {
      expect(posted).toEqual(['How about a screenshot?']);
      screen.getByText('How about a screenshot?');
    });
  });

  test('the Post button is disabled until a non-empty comment is entered', async () => {
    const fetchImpl = (async () => jsonResponse({ comments: [] })) as unknown as typeof fetch;

    renderThread(fetchImpl);

    await waitFor(() => screen.getByText(/no comments yet/i));

    const post = screen.getByRole('button', { name: /post/i });
    expect(post).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByLabelText(/add a comment/i), { target: { value: 'hi' } });
    expect(post).toHaveProperty('disabled', false);
  });
});
