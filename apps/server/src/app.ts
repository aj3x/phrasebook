import type { Database } from '@phrasebook/db';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Kysely } from 'kysely';
import type { Auth } from './auth';
import { requireRole } from './middleware/require-role';
import type { AuthContext } from './middleware/session';
import { createSessionMiddleware } from './middleware/session';
import { InvalidTransitionError } from './status';
import { SaveConflictError } from './store/store';
import type { Store } from './store/store';

const CAN_SAVE_TRANSLATIONS = ['Admin', 'Developer', 'Translator', 'Reviewer'];
const CAN_REVIEW_TRANSLATIONS = ['Admin', 'Developer', 'Reviewer'];

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

  app.get('/v1/projects', async (c) => {
    const authContext = c.get('authContext');
    if (!authContext) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const allProjects = authContext.roles.some((grant) => grant.projectId === null);
    const projectIds = [
      ...new Set(
        authContext.roles
          .map((grant) => grant.projectId)
          .filter((projectId): projectId is string => projectId !== null),
      ),
    ];

    const projects = await store.listAccessibleProjects({ allProjects, projectIds });
    return c.json({ projects });
  });

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

  app.put(
    '/v1/projects/:project/translations/:namespace/:locale/:key',
    requireRole(db, CAN_SAVE_TRANSLATIONS),
    async (c) => {
      const { project, namespace, locale, key } = c.req.param();
      const body = await c.req.json().catch(() => ({}));
      if (typeof body.targetText !== 'string') {
        return c.json({ error: 'targetText is required' }, 400);
      }

      try {
        const status = await store.saveTranslation({
          project,
          namespace,
          locale,
          key,
          targetText: body.targetText,
          originalText: typeof body.originalText === 'string' ? body.originalText : undefined,
        });
        return c.json({ status });
      } catch (err) {
        if (err instanceof SaveConflictError) {
          return c.json({ error: 'conflict', currentText: err.currentText }, 409);
        }
        return c.json({ error: (err as Error).message }, 404);
      }
    },
  );

  app.post(
    '/v1/projects/:project/translations/:namespace/:locale/:key/claim',
    requireRole(db, CAN_REVIEW_TRANSLATIONS),
    async (c) => {
      const { project, namespace, locale, key } = c.req.param();
      try {
        const status = await store.claimTranslationForReview({ project, namespace, locale, key });
        return c.json({ status });
      } catch (err) {
        return translationErrorResponse(c, err);
      }
    },
  );

  app.post(
    '/v1/projects/:project/translations/:namespace/:locale/:key/approve',
    requireRole(db, CAN_REVIEW_TRANSLATIONS),
    async (c) => {
      const { project, namespace, locale, key } = c.req.param();
      try {
        const status = await store.approveTranslation({ project, namespace, locale, key });
        return c.json({ status });
      } catch (err) {
        return translationErrorResponse(c, err);
      }
    },
  );

  app.post(
    '/v1/projects/:project/translations/:namespace/:locale/:key/send-back',
    requireRole(db, CAN_REVIEW_TRANSLATIONS),
    async (c) => {
      const { project, namespace, locale, key } = c.req.param();
      const body = await c.req.json().catch(() => ({}));
      if (typeof body.comment !== 'string') {
        return c.json({ error: 'comment is required' }, 400);
      }

      try {
        const status = await store.sendTranslationBack(
          { project, namespace, locale, key },
          body.comment,
        );
        return c.json({ status });
      } catch (err) {
        return translationErrorResponse(c, err);
      }
    },
  );

  return app;
}

/**
 * A rejected state transition (§5's rules -- e.g. approving a translation
 * that was never claimed) is a 409: the request is well-formed but
 * conflicts with the resource's current state. Anything else here means
 * resolveRefIds/findTranslation couldn't find the project/namespace/
 * locale/key/translation at all, which is a 404.
 */
// biome-ignore lint/suspicious/noExplicitAny: Hono's Context generic varies per call site; only c.json is used here.
function translationErrorResponse(c: any, err: unknown) {
  if (err instanceof InvalidTransitionError) {
    return c.json({ error: err.message }, 409);
  }
  return c.json({ error: (err as Error).message }, 404);
}
