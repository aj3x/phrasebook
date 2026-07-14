import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { LoginScreen } from './LoginScreen';
import { ProjectPicker } from './ProjectPicker';
import { ProjectView } from './ProjectView';
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
 * authenticated ones see ProjectPicker or (once a project is picked)
 * ProjectView. There's no router yet (M2's scope doesn't need
 * URL-addressable screens) -- session state and `selectedProject` alone
 * decide which renders, and authClient.useSession()'s own reactivity
 * (its internal store updates on sign-in/sign-out) is what flips between
 * signed-in and signed-out, not any state this component tracks itself.
 */
export function App({ authClient, endpoint, queryClient, fetchImpl }: AppProps) {
  const [client] = useState(() => queryClient ?? new QueryClient());
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return <p>Loading…</p>;
  }

  function handleSignOut() {
    setSelectedProject(null);
    authClient.signOut();
  }

  return (
    <QueryClientProvider client={client}>
      {(() => {
        if (!session) {
          return <LoginScreen authClient={authClient} />;
        }
        if (selectedProject) {
          return (
            <ProjectView
              endpoint={endpoint}
              project={selectedProject}
              onBack={() => setSelectedProject(null)}
              fetchImpl={fetchImpl}
            />
          );
        }
        return (
          <ProjectPicker
            endpoint={endpoint}
            onSignOut={handleSignOut}
            onSelectProject={setSelectedProject}
            fetchImpl={fetchImpl}
          />
        );
      })()}
    </QueryClientProvider>
  );
}
