import { Hono } from 'hono';
import type { Store } from '../store/store';
import type { Env } from '../types';

/**
 * The M1 runtime delivery endpoint -- deliberately public (no authContext
 * check): it's what `@phrasebook/core` polls from a running app, not an
 * editor-facing route.
 */
export function createRuntimeRoutes(store: Store) {
  const app = new Hono<Env>();

  app.get('/runtime/:project/:locale/:namespace', async (c) => {
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
