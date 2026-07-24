import type { Database } from '@phrasebook/db';
import { Hono } from 'hono';
import type { Kysely } from 'kysely';
import { requireProjectAndLocalePermission } from '../middleware/permission';
import type { Store } from '../store/store';
import type { Env } from '../types';

export function createCommentsRoutes(store: Store, db: Kysely<Database>) {
  const app = new Hono<Env>();

  app.get(
    '/projects/:project/comments/:namespace/:locale/:key',
    requireProjectAndLocalePermission(db, store, 'comment:view'),
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
    '/projects/:project/comments/:namespace/:locale/:key',
    // Viewers can read the thread but not post to it (they hold comment:view,
    // not comment:create); everyone else who can touch a translation can comment.
    requireProjectAndLocalePermission(db, store, 'comment:create'),
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
