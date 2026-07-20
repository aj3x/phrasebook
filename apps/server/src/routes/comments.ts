import type { Database } from '@phrasebook/db';
import { Hono } from 'hono';
import type { Kysely } from 'kysely';
import { requireProjectAndLocaleScope } from '../middleware/scope';
import { ANY_ROLE, CAN_SAVE_TRANSLATIONS } from '../roles';
import type { Store } from '../store/store';
import type { Env } from '../types';

export function createCommentsRoutes(store: Store, db: Kysely<Database>) {
  const app = new Hono<Env>();

  app.get(
    '/projects/:project/comments/:namespace/:locale/:key',
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
    '/projects/:project/comments/:namespace/:locale/:key',
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
