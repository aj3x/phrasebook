import type { Database } from '@phrasebook/db';
import type { MiddlewareHandler } from 'hono';
import type { Kysely } from 'kysely';
import type { Store } from '../store/store';
import type { Env } from '../types';
import type { AuthContext } from './session';

export interface RoleScope {
  workspaceId?: string;
  projectId?: string;
  localeCode?: string;
}

/**
 * One scope dimension of a grant against one dimension of a request. The
 * two ways to pass are deliberately distinct: the grant is NULL ("all",
 * §F3), or the request doesn't ask about this dimension at all -- which is
 * how a project-level route stays usable by a locale-scoped grant.
 */
function dimensionCovers(granted: string | null, requested: string | undefined): boolean {
  return requested === undefined || granted === null || granted === requested;
}

/**
 * Workspace/project/locale-scoped role check (§F3 "language-dependent
 * roles"), separate from requireRole's instance-wide check.
 *
 * The three dimensions are independent and ANDed: a grant covers a request
 * only if it covers every dimension the request names. Adding workspace
 * was therefore a uniform extension rather than a special case -- which is
 * the property that keeps M7 (real, user-facing workspaces) a feature
 * milestone instead of a rewrite of this matcher.
 */
export function hasScopedRole(
  authContext: AuthContext | null,
  roleNames: string[],
  scope: RoleScope = {},
): boolean {
  if (!authContext) return false;

  return authContext.roles.some(
    (grant) =>
      roleNames.includes(grant.role) &&
      dimensionCovers(grant.workspaceId, scope.workspaceId) &&
      dimensionCovers(grant.projectId, scope.projectId) &&
      dimensionCovers(grant.localeCode, scope.localeCode),
  );
}

/**
 * Write-path gate for routes that carry both :project and :locale in
 * their URL (translation save/claim/approve/send-back). Combines
 * requireRole's auth+locked+role check with a hasScopedRole check
 * against the URL's project and locale, so a Translator scoped to
 * (projectA, fr) can't reach into (projectB, *) or (projectA, de).
 * Instance-wide grants (project_id=NULL and locale_code=NULL) still
 * pass everywhere.
 */
export function requireProjectAndLocaleScope(
  db: Kysely<Database>,
  store: Store,
  roleNames: string[],
): MiddlewareHandler<Env> {
  return async (c, next) => {
    const authContext = c.get('authContext');
    if (!authContext) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const user = await db
      .selectFrom('user')
      .select('locked')
      .where('id', '=', authContext.userId)
      .executeTakeFirst();
    if (user?.locked) {
      return c.json({ error: 'Account locked' }, 403);
    }

    const project = c.req.param('project');
    const locale = c.req.param('locale');
    if (!project || !locale) {
      return c.json({ error: 'Not found' }, 404);
    }

    const projectId = await store.findProjectId(project);
    if (!projectId) {
      return c.json({ error: 'Not found' }, 404);
    }

    if (!hasScopedRole(authContext, roleNames, { projectId, localeCode: locale })) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    await next();
  };
}

/**
 * Project-only sibling of requireProjectAndLocaleScope, for routes that
 * carry :project but no :locale (project-level settings like the
 * auto-approve toggle). Same auth+locked+project-scope check, minus the
 * locale dimension -- a role grant scoped to a single locale within the
 * project still counts as covering the project here, since the setting
 * isn't locale-specific.
 */
export function requireProjectScope(
  db: Kysely<Database>,
  store: Store,
  roleNames: string[],
): MiddlewareHandler<Env> {
  return async (c, next) => {
    const authContext = c.get('authContext');
    if (!authContext) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const user = await db
      .selectFrom('user')
      .select('locked')
      .where('id', '=', authContext.userId)
      .executeTakeFirst();
    if (user?.locked) {
      return c.json({ error: 'Account locked' }, 403);
    }

    const project = c.req.param('project');
    if (!project) {
      return c.json({ error: 'Not found' }, 404);
    }

    const projectId = await store.findProjectId(project);
    if (!projectId) {
      return c.json({ error: 'Not found' }, 404);
    }

    if (!hasScopedRole(authContext, roleNames, { projectId })) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    await next();
  };
}
