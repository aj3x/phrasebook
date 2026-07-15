import type { Database } from '@phrasebook/db';
import type { MiddlewareHandler } from 'hono';
import type { Kysely } from 'kysely';
import type { Store } from '../store/store';
import type { AuthContext } from './session';

type Env = { Variables: { authContext: AuthContext | null } };

export interface RoleScope {
  projectId?: string;
  localeCode?: string;
}

/**
 * Project/locale-scoped role check (§F3 "language-dependent roles"),
 * separate from requireRole's instance-wide check. A grant's NULL
 * project_id/locale_code is a wildcard for that dimension (§F3: "NULL
 * means all"); a dimension not present in `scope` is simply not checked,
 * so a route that doesn't care about locale can still gate on project
 * alone.
 */
export function hasScopedRole(
  authContext: AuthContext | null,
  roleNames: string[],
  scope: RoleScope = {},
): boolean {
  if (!authContext) return false;

  return authContext.roles.some((grant) => {
    if (!roleNames.includes(grant.role)) return false;
    if (
      scope.projectId !== undefined &&
      grant.projectId !== null &&
      grant.projectId !== scope.projectId
    ) {
      return false;
    }
    if (
      scope.localeCode !== undefined &&
      grant.localeCode !== null &&
      grant.localeCode !== scope.localeCode
    ) {
      return false;
    }
    return true;
  });
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
