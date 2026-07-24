import type { Database } from '@phrasebook/db';
import type { MiddlewareHandler } from 'hono';
import type { Kysely } from 'kysely';
import { type Permission, parsePermission, permissionSatisfies } from '../permissions';
import type { Store } from '../store/store';
import type { Env } from '../types';
import type { AuthContext } from './session';

/**
 * The permission-checking siblings of require-role.ts / scope.ts. M3 (see
 * plan/03-milestone-3-onboarding.md, Phase A) replaces role-name checks with
 * `resource:action` permission checks: `requireRole(names)` becomes
 * `requirePermission('translation:save')`, and `hasScopedRole(names, scope)`
 * becomes `hasPermission(ctx, 'translation:save', scope)`. Built alongside the
 * role-name versions in step 5; step 6 swaps the routes over and deletes the
 * old ones, leaving one authorization mechanism.
 */

export interface PermissionScope {
  workspaceId?: string;
  projectId?: string;
  localeCode?: string;
}

/**
 * One scope dimension of a grant against one dimension of a request: the
 * grant is NULL ("all", §F3), or the request doesn't name this dimension at
 * all. Mirrors scope.ts -- kept local so the permission machinery is
 * self-contained once the role-name path is deleted.
 */
function dimensionCovers(granted: string | null, requested: string | undefined): boolean {
  return requested === undefined || granted === null || granted === requested;
}

/**
 * Does the signed-in user hold a grant that both covers this scope and
 * carries a permission pattern satisfying `required`?
 *
 * Additive-only (§D4): a request passes if ANY grant matches -- there are no
 * deny rules, so a single covering grant is enough and grant order is
 * irrelevant. `required` is always concrete (route code asks for
 * `translation:save`, never a wildcard); parsePermission validates that and
 * throws on a wildcard, catching a would-be silently-permissive query as a
 * programming error.
 */
export function hasPermission(
  authContext: AuthContext | null,
  required: string,
  scope: PermissionScope = {},
): boolean {
  if (!authContext) return false;

  const requiredPermission: Permission = parsePermission(required);

  return authContext.roles.some(
    (grant) =>
      dimensionCovers(grant.workspaceId, scope.workspaceId) &&
      dimensionCovers(grant.projectId, scope.projectId) &&
      dimensionCovers(grant.localeCode, scope.localeCode) &&
      grant.permissions.some((held) => permissionSatisfies(held, requiredPermission)),
  );
}

/**
 * Shared 401/locked gate. Returns the auth context on success, or a Response
 * to short-circuit -- the locked flag is the one revoke-everything mechanism
 * (§D4/F3), checked before any permission so a locked account is refused
 * regardless of what it holds. Exported for handlers that must resolve the
 * actor themselves before a scope-dependent permission check (e.g. role
 * assignment, where the scope to check comes from the DB row, not the URL).
 */
export async function requireUnlocked(
  c: Parameters<MiddlewareHandler<Env>>[0],
  db: Kysely<Database>,
): Promise<AuthContext | Response> {
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

  return authContext;
}

/**
 * Instance-wide permission gate (no scope): the sibling of requireRole. Used
 * where a permission isn't tied to a particular project/locale in the URL.
 */
export function requirePermission(db: Kysely<Database>, required: string): MiddlewareHandler<Env> {
  return async (c, next) => {
    const result = await requireUnlocked(c, db);
    if (result instanceof Response) return result;

    if (!hasPermission(result, required)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    await next();
  };
}

/**
 * Project+locale-scoped permission gate: the sibling of
 * requireProjectAndLocaleScope, for routes carrying :project and :locale
 * (translation save/claim/approve/send-back, comments). Resolves the URL's
 * project to an id and checks the required permission against that scope, so
 * a grant scoped to (projectA, fr) can't reach (projectB, *) or (projectA, de).
 */
export function requireProjectAndLocalePermission(
  db: Kysely<Database>,
  store: Store,
  required: string,
): MiddlewareHandler<Env> {
  return async (c, next) => {
    const result = await requireUnlocked(c, db);
    if (result instanceof Response) return result;

    const project = c.req.param('project');
    const locale = c.req.param('locale');
    if (!project || !locale) {
      return c.json({ error: 'Not found' }, 404);
    }

    const projectId = await store.findProjectId(project);
    if (!projectId) {
      return c.json({ error: 'Not found' }, 404);
    }

    if (!hasPermission(result, required, { projectId, localeCode: locale })) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    await next();
  };
}

/**
 * Project-only-scoped permission gate: the sibling of requireProjectScope, for
 * routes carrying :project but no :locale (project settings). A grant scoped
 * to a single locale within the project still counts as covering the project
 * here, since the checked permission isn't locale-specific.
 */
export function requireProjectPermission(
  db: Kysely<Database>,
  store: Store,
  required: string,
): MiddlewareHandler<Env> {
  return async (c, next) => {
    const result = await requireUnlocked(c, db);
    if (result instanceof Response) return result;

    const project = c.req.param('project');
    if (!project) {
      return c.json({ error: 'Not found' }, 404);
    }

    const projectId = await store.findProjectId(project);
    if (!projectId) {
      return c.json({ error: 'Not found' }, 404);
    }

    if (!hasPermission(result, required, { projectId })) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    await next();
  };
}
