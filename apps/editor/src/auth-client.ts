import { createAuthClient } from 'better-auth/react';

export const API_ENDPOINT = import.meta.env.VITE_API_ENDPOINT ?? 'http://localhost:3000';

/**
 * The minimal shape App/LoginScreen actually call -- kept narrow (rather
 * than better-auth's full inferred ReactAuthClient<Option> type) so tests
 * can pass a small fake instead of driving real HTTP through the auth
 * client's internal store.
 */
export interface AuthClient {
  useSession: () => {
    data: { user: { email: string } } | null | undefined;
    isPending: boolean;
  };
  signIn: {
    email: (input: {
      email: string;
      password: string;
    }) => Promise<{ error: { message?: string } | null }>;
  };
  signOut: () => Promise<unknown>;
}

export const authClient: AuthClient = createAuthClient({
  baseURL: API_ENDPOINT,
});
