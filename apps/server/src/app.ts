import type { Database } from '@phrasebook/db';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Kysely } from 'kysely';
import type { Auth } from './auth';
import { createSessionMiddleware } from './middleware/session';
import { createCommentsRoutes } from './routes/comments';
import { createDevRoutes } from './routes/dev';
import { createKeysRoutes } from './routes/keys';
import { createProjectsRoutes } from './routes/projects';
import { createRoleAssignmentsRoutes } from './routes/role-assignments';
import { createRuntimeRoutes } from './routes/runtime';
import { createSetupRoutes } from './routes/setup';
import { createTranslationsRoutes } from './routes/translations';
import type { Store } from './store/store';
import type { Env } from './types';

// apps/editor's Vite dev server (vite.config.ts pins this explicitly so it
// doesn't drift if some other app on 5173 changes which port Vite falls
// back to).
const EDITOR_DEV_ORIGIN = 'http://localhost:5174';
const DEMO_WEB_DEV_ORIGIN = 'http://localhost:5173';
const ORIGINS = [DEMO_WEB_DEV_ORIGIN, EDITOR_DEV_ORIGIN];

/**
 * Composition root: CORS, session resolution, and mounting each resource's
 * route module. Route handlers themselves live in `./routes/*` -- this
 * file should stay small as the API grows (see plan/01-repo-topology.md);
 * a new resource is a new `routes/*.ts` file plus one `app.route()` call
 * here, not a growing list of inline handlers.
 */
export function createApp(
  store: Store,
  auth: Auth,
  db: Kysely<Database>,
  origin: string[] = ORIGINS,
) {
  const app = new Hono<Env>();

  app.use('/v1/runtime/*', cors({ origin }));
  app.use('/v1/*', cors({ origin, credentials: true }));

  app.use(
    '/api/auth/*',
    cors({
      origin,
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['POST', 'GET', 'OPTIONS'],
      credentials: true,
    }),
  );
  app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));

  // Resolves the session for every route (authContext is null if there's no
  // session) -- it never rejects by itself. requirePermission/hasPermission are
  // what actually gate a route; /v1/* simply doesn't check authContext, so
  // this doesn't change the M1 runtime endpoint's public/unauthenticated
  // behavior.
  app.use('*', createSessionMiddleware(auth, db));

  app.get('/health', (c) => c.text('OK'));

  app.route('/v1', createSetupRoutes(auth, db));
  app.route('/v1', createRuntimeRoutes(store));
  app.route('/v1', createProjectsRoutes(store, db));
  app.route('/v1', createKeysRoutes(store));
  app.route('/v1', createTranslationsRoutes(store, db));
  app.route('/v1', createCommentsRoutes(store, db));
  app.route('/v1', createRoleAssignmentsRoutes(db));
  app.route('/v1', createDevRoutes(auth, db));

  return app;
}
