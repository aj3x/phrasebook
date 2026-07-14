import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { LoginScreen } from './LoginScreen';
import { ProjectPicker } from './ProjectPicker';
import type { FetchImpl } from './api';
import type { AuthClient } from './auth-client';

export interface AppProps {
  authClient: AuthClient;
  endpoint: string;
  queryClient?: QueryClient;
  fetchImpl?: FetchImpl;
}

/**
 * The auth-gated shell: unauthenticated visitors see LoginScreen,
 * authenticated ones see ProjectPicker. There's no router yet (M2's scope
 * doesn't need URL-addressable screens beyond this pair) -- session state
 * alone decides which renders, and authClient.useSession()'s own
 * reactivity (its internal store updates on sign-in/sign-out) is what
 * flips between them, not any state this component tracks itself.
 */
export function App({ authClient, endpoint, queryClient, fetchImpl }: AppProps) {
  const [client] = useState(() => queryClient ?? new QueryClient());
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return <p>Loading…</p>;
  }

  return (
    <QueryClientProvider client={client}>
      {session ? (
        <ProjectPicker
          endpoint={endpoint}
          onSignOut={() => authClient.signOut()}
          fetchImpl={fetchImpl}
        />
      ) : (
        <LoginScreen authClient={authClient} />
      )}
    </QueryClientProvider>
  );
}
