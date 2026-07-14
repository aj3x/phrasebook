import type { Database } from '@phrasebook/db';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Kysely } from 'kysely';
import type { Auth } from './auth';
import type { AuthContext } from './middleware/session';
import { createSessionMiddleware } from './middleware/session';
import type { Store } from './store/store';

// apps/editor doesn't exist yet (M2 step 6) -- this is a placeholder dev
// port, the next one Vite picks when 5173 (demo-web) is taken. Update once
// the editor is actually scaffolded and its real dev port is known.
const EDITOR_DEV_ORIGIN = 'http://localhost:5174';

export function createApp(store: Store, auth: Auth, db: Kysely<Database>) {
  const app = new Hono<{ Variables: { authContext: AuthContext | null } }>();

  app.use('/v1/*', cors({ origin: 'http://localhost:5173' }));

  app.use(
    '/api/auth/*',
    cors({
      origin: EDITOR_DEV_ORIGIN,
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['POST', 'GET', 'OPTIONS'],
      credentials: true,
    }),
  );
  app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));

  // Resolves the session for every route (authContext is null if there's no
  // session) -- it never rejects by itself. requireRole/hasScopedRole are
  // what actually gate a route; /v1/* simply doesn't check authContext, so
  // this doesn't change the M1 runtime endpoint's public/unauthenticated
  // behavior.
  app.use('*', createSessionMiddleware(auth, db));

  app.get('/health', (c) => c.text('OK'));

  app.get('/v1/runtime/:project/:locale/:namespace', async (c) => {
    const { project, locale, namespace } = c.req.param();
    const bundle = await store.getBundle(project, locale, namespace);

    if (!bundle) {
      return c.json({ error: 'Not found' }, 404);
    }

    if (c.req.header('If-None-Match') === bundle.etag) {
      return c.body(null, 304);
    }

    c.header('ETag', bundle.etag);
    c.header('Cache-Control', 'public, max-age=60, must-revalidate');

    return c.json({
      locale,
      namespace,
      version: bundle.version,
      keys: bundle.keys,
    });
  });

  return app;
}
