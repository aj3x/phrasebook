import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { LoginScreen } from '../src/LoginScreen';
import { createFakeAuthClient } from './fake-auth-client';

describe('LoginScreen', () => {
  test('submits without an error for correct credentials', async () => {
    const authClient = createFakeAuthClient();
    render(<LoginScreen authClient={authClient} />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'admin@phrasebook.local' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'correct-horse-battery-staple' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  test('shows an error message for the wrong password', async () => {
    const authClient = createFakeAuthClient();
    render(<LoginScreen authClient={authClient} />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'admin@phrasebook.local' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'wrong-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      screen.getByRole('alert');
    });
    expect(screen.getByRole('alert').textContent).toMatch(/invalid/i);
  });
});
