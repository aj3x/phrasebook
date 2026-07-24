import type { Database } from '@phrasebook/db';
import { Hono } from 'hono';
import type { Kysely } from 'kysely';
import { requireProjectAndLocalePermission } from '../middleware/permission';
import { InvalidTransitionError } from '../status';
import { SaveConflictError, SelfApprovalError } from '../store/store';
import type { Store } from '../store/store';
import type { Env } from '../types';

export function createTranslationsRoutes(store: Store, db: Kysely<Database>) {
  const app = new Hono<Env>();

  app.put(
    '/projects/:project/translations/:namespace/:locale/:key',
    requireProjectAndLocalePermission(db, store, 'translation:save'),
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
    '/projects/:project/translations/:namespace/:locale/:key/claim',
    requireProjectAndLocalePermission(db, store, 'translation:claim'),
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
    '/projects/:project/translations/:namespace/:locale/:key/approve',
    requireProjectAndLocalePermission(db, store, 'translation:approve'),
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
    '/projects/:project/translations/:namespace/:locale/:key/send-back',
    requireProjectAndLocalePermission(db, store, 'translation:send_back'),
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
