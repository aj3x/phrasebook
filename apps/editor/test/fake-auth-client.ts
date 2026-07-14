import { useSyncExternalStore } from 'react';
import type { AuthClient } from '../src/auth-client';

const VALID_PASSWORD = 'correct-horse-battery-staple';

/**
 * A real better-auth client drives HTTP + a reactive store internally;
 * mirroring just enough of that shape (a subscribable session) lets
 * LoginScreen/ProjectPicker/App tests exercise the actual sign-in ->
 * session-updates -> re-render flow without hitting real HTTP or mocking
 * the better-auth module.
 */
export function createFakeAuthClient(initialEmail?: string): AuthClient {
  let session: { user: { email: string } } | null = initialEmail
    ? { user: { email: initialEmail } }
    : null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    useSession() {
      const data = useSyncExternalStore(
        (onStoreChange) => {
          listeners.add(onStoreChange);
          return () => listeners.delete(onStoreChange);
        },
        () => session,
      );
      return { data, isPending: false };
    },
    signIn: {
      async email({ email, password }) {
        if (password !== VALID_PASSWORD) {
          return { error: { message: 'Invalid email or password' } };
        }
        session = { user: { email } };
        notify();
        return { error: null };
      },
    },
    async signOut() {
      session = null;
      notify();
    },
  };
}
