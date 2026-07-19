import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Outlet,
  RouterProvider,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
  useNavigate,
} from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { LoginScreen } from './LoginScreen';
import { ProjectPicker } from './ProjectPicker';
import { ProjectView } from './ProjectView';
import type { FetchImpl } from './api';
import type { AuthClient } from './auth-client';

interface RouterContext {
  authClient: AuthClient;
  endpoint: string;
  queryClient: QueryClient;
  fetchImpl?: FetchImpl;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/login' });
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'auth',
  component: AuthGuard,
});

const projectsRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/projects',
  component: ProjectsPage,
});

const projectRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/project/$projectName',
  component: ProjectPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  authRoute.addChildren([projectsRoute, projectRoute]),
]);

function RootLayout() {
  const { queryClient } = rootRoute.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}

function LoginPage() {
  const { authClient } = loginRoute.useRouteContext();
  const { data: session, isPending } = authClient.useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isPending && session) {
      navigate({ to: '/projects' });
    }
  }, [session, isPending, navigate]);

  if (isPending) return <p>Loading…</p>;
  if (session) return null;

  return <LoginScreen authClient={authClient} />;
}

function AuthGuard() {
  const { authClient } = authRoute.useRouteContext();
  const { data: session, isPending } = authClient.useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isPending && !session) {
      navigate({ to: '/login' });
    }
  }, [session, isPending, navigate]);

  if (isPending || !session) return <p>Loading…</p>;

  return <Outlet />;
}

function ProjectsPage() {
  const { authClient, endpoint, fetchImpl } = projectsRoute.useRouteContext();
  const navigate = useNavigate();

  return (
    <ProjectPicker
      endpoint={endpoint}
      fetchImpl={fetchImpl}
      onSignOut={() => authClient.signOut()}
      onSelectProject={(name) =>
        navigate({ to: '/project/$projectName', params: { projectName: name } })
      }
    />
  );
}

function ProjectPage() {
  const { endpoint, fetchImpl } = projectRoute.useRouteContext();
  const { projectName } = projectRoute.useParams();
  const navigate = useNavigate();

  return (
    <ProjectView
      endpoint={endpoint}
      project={projectName}
      fetchImpl={fetchImpl}
      onBack={() => navigate({ to: '/projects' })}
    />
  );
}

export interface AppProps {
  authClient: AuthClient;
  endpoint: string;
  queryClient?: QueryClient;
  fetchImpl?: FetchImpl;
}

export function App({ authClient, endpoint, queryClient: queryClientProp, fetchImpl }: AppProps) {
  const [queryClient] = useState(() => queryClientProp ?? new QueryClient());
  const [router] = useState(() =>
    createRouter({
      routeTree,
      context: { authClient, endpoint, queryClient, fetchImpl },
    }),
  );

  return <RouterProvider router={router} />;
}
