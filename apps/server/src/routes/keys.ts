import { Hono } from 'hono';
import { hasScopedRole } from '../middleware/scope';
import { ANY_ROLE } from '../roles';
import type { Store } from '../store/store';
import type { Env } from '../types';

export function createKeysRoutes(store: Store) {
  const app = new Hono<Env>();

  app.get('/projects/:project/keys', async (c) => {
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

  return app;
}
