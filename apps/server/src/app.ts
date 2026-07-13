import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Store } from './store/store';

export function createApp(store: Store) {
  const app = new Hono();

  app.use('/v1/*', cors({ origin: 'http://localhost:5173' }));

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
