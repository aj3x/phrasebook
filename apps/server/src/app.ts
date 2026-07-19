import type { Database } from '@phrasebook/db';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Kysely } from 'kysely';
import type { Auth } from './auth';
import {
  hasScopedRole,
  requireProjectAndLocaleScope,
  requireProjectScope,
} from './middleware/scope';
import type { AuthContext } from './middleware/session';
import { createSessionMiddleware } from './middleware/session';
import { InvalidTransitionError } from './status';
import { SaveConflictError, SelfApprovalError } from './store/store';
import type { Store } from './store/store';

const CAN_SAVE_TRANSLATIONS = ['Admin', 'Developer', 'Translator', 'Reviewer'];
const CAN_REVIEW_TRANSLATIONS = ['Admin', 'Developer', 'Reviewer'];
// Project configuration (e.g. the auto-approve review policy) is an admin/
// dev concern -- translators and reviewers work within the policy, they
// don't set it.
const CAN_MANAGE_PROJECT = ['Admin', 'Developer'];
const ANY_ROLE = ['Admin', 'Developer', 'Translator', 'Reviewer', 'Viewer'];

// apps/editor's Vite dev server (vite.config.ts pins this explicitly so it
// doesn't drift if some other app on 5173 changes which port Vite falls
// back to).
const EDITOR_DEV_ORIGIN = 'http://localhost:5174';
const DEMO_WEB_DEV_ORIGIN = 'http://localhost:5173';
const ORIGINS = [DEMO_WEB_DEV_ORIGIN, EDITOR_DEV_ORIGIN];

export function createApp(store: Store, auth: Auth, db: Kysely<Database>, origin: string[] = ORIGINS) {
  const app = new Hono<{ Variables: { authContext: AuthContext | null } }>();

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

  app.get('/v1/projects/:project', async (c) => {
    const authContext = c.get('authContext');
    if (!authContext) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const { project } = c.req.param();
    const projectId = await store.findProjectId(project);
    if (!projectId) {
      return c.json({ error: 'Not found' }, 404);
    }
    if (!hasScopedRole(authContext, ANY_ROLE, { projectId })) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const detail = await store.getProjectDetail(project);
    return c.json(detail);
  });

  app.patch(
    '/v1/projects/:project/settings',
    requireProjectScope(db, store, CAN_MANAGE_PROJECT),
    async (c) => {
      const { project } = c.req.param();
      const body = await c.req.json().catch(() => ({}));
      if (typeof body.autoApprove !== 'boolean') {
        return c.json({ error: 'autoApprove (boolean) is required' }, 400);
      }

      const autoApprove = await store.setProjectAutoApprove(project, body.autoApprove);
      return c.json({ autoApprove });
    },
  );

  app.get('/v1/projects/:project/keys', async (c) => {
    const authContext = c.get('authContext');
    if (!authContext) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const { project } = c.req.param();
    const projectId = await store.findProjectId(project);
    if (!projectId) {
      return c.json({ error: 'Not found' }, 404);
    }
    if (!hasScopedRole(authContext, ANY_ROLE, { projectId })) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const namespace = c.req.query('namespace');
    const locale = c.req.query('locale');
    if (!namespace || !locale) {
      return c.json({ error: 'namespace and locale query params are required' }, 400);
    }
    const status = c.req.query('status');

    try {
      const keys = await store.listKeys(
        { project, namespace, locale },
        status ? { status } : undefined,
      );
      return c.json({ keys });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 404);
    }
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
    requireProjectAndLocaleScope(db, store, CAN_SAVE_TRANSLATIONS),
    async (c) => {
      const { project, namespace, locale, key } = c.req.param();
      const authContext = c.get('authContext');
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
          editorUserId: authContext?.userId,
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
    requireProjectAndLocaleScope(db, store, CAN_REVIEW_TRANSLATIONS),
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
    requireProjectAndLocaleScope(db, store, CAN_REVIEW_TRANSLATIONS),
    async (c) => {
      const { project, namespace, locale, key } = c.req.param();
      const authContext = c.get('authContext');
      try {
        const status = await store.approveTranslation(
          { project, namespace, locale, key },
          authContext?.userId,
        );
        return c.json({ status });
      } catch (err) {
        return translationErrorResponse(c, err);
      }
    },
  );

  app.post(
    '/v1/projects/:project/translations/:namespace/:locale/:key/send-back',
    requireProjectAndLocaleScope(db, store, CAN_REVIEW_TRANSLATIONS),
    async (c) => {
      const { project, namespace, locale, key } = c.req.param();
      const authContext = c.get('authContext');
      const body = await c.req.json().catch(() => ({}));
      if (typeof body.comment !== 'string') {
        return c.json({ error: 'comment is required' }, 400);
      }

      try {
        const status = await store.sendTranslationBack(
          { project, namespace, locale, key },
          body.comment,
          authContext?.userId,
        );
        return c.json({ status });
      } catch (err) {
        return translationErrorResponse(c, err);
      }
    },
  );

  app.get(
    '/v1/projects/:project/comments/:namespace/:locale/:key',
    requireProjectAndLocaleScope(db, store, ANY_ROLE),
    async (c) => {
      const { project, namespace, locale, key } = c.req.param();
      try {
        const comments = await store.listComments({ project, namespace, locale, key });
        return c.json({ comments });
      } catch (err) {
        return c.json({ error: (err as Error).message }, 404);
      }
    },
  );

  app.post(
    '/v1/projects/:project/comments/:namespace/:locale/:key',
    // Viewers can read the thread but not post to it; everyone else who can
    // touch a translation can comment.
    requireProjectAndLocaleScope(db, store, CAN_SAVE_TRANSLATIONS),
    async (c) => {
      const { project, namespace, locale, key } = c.req.param();
      const authContext = c.get('authContext');
      if (!authContext) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
      const body = await c.req.json().catch(() => ({}));
      if (typeof body.body !== 'string' || body.body.trim() === '') {
        return c.json({ error: 'body is required' }, 400);
      }

      try {
        const comment = await store.addComment({
          project,
          namespace,
          locale,
          key,
          authorId: authContext.userId,
          body: body.body,
        });
        return c.json({ comment }, 201);
      } catch (err) {
        return c.json({ error: (err as Error).message }, 404);
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
  if (err instanceof SelfApprovalError) {
    return c.json({ error: err.message }, 403);
  }
  if (err instanceof InvalidTransitionError) {
    return c.json({ error: err.message }, 409);
  }
  return c.json({ error: (err as Error).message }, 404);
}
