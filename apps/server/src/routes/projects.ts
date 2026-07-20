import type { Database } from '@phrasebook/db';
import { Hono } from 'hono';
import type { Kysely } from 'kysely';
import { hasScopedRole, requireProjectScope } from '../middleware/scope';
import { ANY_ROLE, CAN_MANAGE_PROJECT } from '../roles';
import type { Store } from '../store/store';
import type { Env } from '../types';

export function createProjectsRoutes(store: Store, db: Kysely<Database>) {
  const app = new Hono<Env>();

  app.get('/projects', async (c) => {
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

  app.get('/projects/:project', async (c) => {
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
    '/projects/:project/settings',
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

  return app;
}
