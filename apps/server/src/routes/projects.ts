import type { Database } from '@phrasebook/db';
import { isSupportedLocale } from '@phrasebook/icu';
import { Hono } from 'hono';
import type { Kysely } from 'kysely';
import { hasPermission, requireProjectPermission, requireUnlocked } from '../middleware/permission';
import type { Store } from '../store/store';
import type { Env } from '../types';

interface NewProject {
  name: string;
  sourceLocale: string;
  targetLocales: string[];
  workspaceId?: string;
}

/**
 * Validates and normalizes the project-creation body. Returns an error string
 * instead of the parsed value on any problem, so the caller maps it to 400.
 * Locale codes are checked against the CLDR set @phrasebook/icu pins, so a
 * project can't be created with a code that would never format.
 */
function parseNewProject(body: Record<string, unknown>): NewProject | { error: string } {
  const { name, sourceLocale, targetLocales, workspaceId } = body;

  if (typeof name !== 'string' || name.trim() === '') {
    return { error: 'name is required' };
  }
  if (typeof sourceLocale !== 'string' || !isSupportedLocale(sourceLocale)) {
    return { error: 'sourceLocale must be a valid locale code' };
  }
  if (!Array.isArray(targetLocales) || targetLocales.some((l) => typeof l !== 'string')) {
    return { error: 'targetLocales must be an array of locale codes' };
  }
  const invalid = (targetLocales as string[]).filter((l) => !isSupportedLocale(l));
  if (invalid.length > 0) {
    return { error: `invalid target locale(s): ${invalid.join(', ')}` };
  }
  if (workspaceId !== undefined && typeof workspaceId !== 'string') {
    return { error: 'workspaceId must be a string' };
  }

  return {
    name: name.trim(),
    sourceLocale,
    targetLocales: targetLocales as string[],
    workspaceId: workspaceId as string | undefined,
  };
}

/**
 * Resolves which workspace a new project belongs to. If the caller named one,
 * it must exist. Otherwise M3's single implicit workspace is used -- an
 * absent workspaceId is the common case until M7 makes workspaces real, and
 * ambiguity (more than one, none supplied) is a 400 asking for an explicit id
 * rather than a silent guess.
 */
async function resolveWorkspaceId(
  db: Kysely<Database>,
  requested: string | undefined,
): Promise<string | { error: string; status: 400 | 404 }> {
  if (requested !== undefined) {
    const row = await db
      .selectFrom('workspaces')
      .select('id')
      .where('id', '=', requested)
      .executeTakeFirst();
    return row ? row.id : { error: 'Unknown workspace', status: 404 };
  }

  const all = await db.selectFrom('workspaces').select('id').limit(2).execute();
  if (all.length === 0) {
    return { error: 'No workspace exists to create a project in', status: 400 };
  }
  if (all.length > 1) {
    return { error: 'workspaceId is required when multiple workspaces exist', status: 400 };
  }
  return all[0]?.id ?? { error: 'No workspace exists to create a project in', status: 400 };
}

export function createProjectsRoutes(store: Store, db: Kysely<Database>) {
  const app = new Hono<Env>();

  /**
   * Reusable project creation (M3 Phase B step 11): the wizard's project step
   * and a future "new project" button both POST here -- there is no
   * wizard-only variant. Gated on `project:create`, which the Owner holds
   * instance-wide and an Admin holds scoped to their workspace (decision 1b),
   * so the scope check is what stops an Admin creating a project in someone
   * else's workspace.
   *
   * Workspace is still implicit in M3 (one exists, created at setup), so the
   * caller may omit workspaceId and it resolves to that single workspace; the
   * body accepts an explicit one for when workspaces become real (M7).
   */
  app.post('/projects', async (c) => {
    const actor = await requireUnlocked(c, db);
    if (actor instanceof Response) return actor;

    const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const parsed = parseNewProject(raw);
    if ('error' in parsed) {
      return c.json({ error: parsed.error }, 400);
    }

    const workspaceId = await resolveWorkspaceId(db, parsed.workspaceId);
    if (typeof workspaceId !== 'string') {
      return c.json({ error: workspaceId.error }, workspaceId.status);
    }

    if (!hasPermission(actor, 'project:create', { workspaceId })) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    // The Store looks projects up by name (findProjectId, getBundle), so names
    // must be unique to stay unambiguous. No DB constraint yet, so reject a
    // duplicate here (best-effort; a benign race is a UX wart, not a security
    // problem).
    const existing = await db
      .selectFrom('projects')
      .select('id')
      .where('name', '=', parsed.name)
      .executeTakeFirst();
    if (existing) {
      return c.json({ error: `A project named "${parsed.name}" already exists` }, 409);
    }

    // Source is itself a translatable locale (matches the seed: source_locale
    // 'en' also has a locales row), so the stored set is source + targets,
    // deduped -- a target repeating the source, or itself, collapses to one row.
    const localeCodes = [...new Set([parsed.sourceLocale, ...parsed.targetLocales])];

    const projectId = crypto.randomUUID();
    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto('projects')
        .values({
          id: projectId,
          workspace_id: workspaceId,
          name: parsed.name,
          source_locale: parsed.sourceLocale,
        })
        .execute();
      await trx
        .insertInto('locales')
        .values(
          localeCodes.map((code) => ({ id: crypto.randomUUID(), project_id: projectId, code })),
        )
        .execute();
    });

    return c.json(
      {
        id: projectId,
        name: parsed.name,
        sourceLocale: parsed.sourceLocale,
        locales: localeCodes,
        workspaceId,
      },
      201,
    );
  });

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
    if (!hasPermission(authContext, 'project:view', { projectId })) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const detail = await store.getProjectDetail(project);
    return c.json(detail);
  });

  app.patch(
    '/projects/:project/settings',
    requireProjectPermission(db, store, 'settings:update'),
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
