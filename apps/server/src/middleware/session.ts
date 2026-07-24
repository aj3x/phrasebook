import type { Database } from '@phrasebook/db';
import type { MiddlewareHandler } from 'hono';
import type { Kysely } from 'kysely';
import type { Auth } from '../auth';
import type { Permission } from '../permissions';

export interface RoleGrant {
  role: string;
  /** Three independent scope dimensions; null means "all" for that one. */
  workspaceId: string | null;
  projectId: string | null;
  localeCode: string | null;
  /**
   * The role's permission patterns (from role_permissions), resolved once
   * here so per-request permission checks are pure in-memory matching with
   * no further DB round-trips. Either segment may be `'*'`; the wildcard
   * rule lives in permissions.ts.
   */
  permissions: Permission[];
}

export interface AuthContext {
  userId: string;
  roles: RoleGrant[];
}

/**
 * Resolves the session cookie into { userId, roles } on c.set("authContext",
 * ...), for every subsequent editor-facing route to read. This middleware
 * only *resolves* -- it never rejects a request itself (authContext is null
 * for an unauthenticated request, next() still runs). Enforcement is a
 * separate requirePermission()-style middleware applied per-route,
 * so a route can distinguish "not logged in" from "logged in, wrong role"
 * without this middleware needing to know which routes require what.
 */
export function createSessionMiddleware(auth: Auth, db: Kysely<Database>): MiddlewareHandler {
  return async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session) {
      c.set('authContext', null);
      await next();
      return;
    }

    const grants = await db
      .selectFrom('role_assignments')
      .innerJoin('roles', 'roles.id', 'role_assignments.role_id')
      .select([
        'role_assignments.role_id',
        'roles.name as role',
        'role_assignments.workspace_id',
        'role_assignments.project_id',
        'role_assignments.locale_code',
      ])
      .where('role_assignments.user_id', '=', session.user.id)
      .execute();

    // Fetch every distinct assigned role's patterns in one query, then
    // attach them per grant in memory -- avoids the row multiplication a
    // three-way join (assignment x role x permission) would produce, and
    // keeps a single DB round-trip regardless of how many roles apply.
    const roleIds = [...new Set(grants.map((g) => g.role_id))];
    const patternsByRole = new Map<string, Permission[]>();
    if (roleIds.length > 0) {
      const rows = await db
        .selectFrom('role_permissions')
        .select(['role_id', 'resource', 'action'])
        .where('role_id', 'in', roleIds)
        .execute();
      for (const row of rows) {
        const list = patternsByRole.get(row.role_id) ?? [];
        list.push({ resource: row.resource, action: row.action });
        patternsByRole.set(row.role_id, list);
      }
    }

    c.set('authContext', {
      userId: session.user.id,
      roles: grants.map((g) => ({
        role: g.role,
        workspaceId: g.workspace_id,
        projectId: g.project_id,
        localeCode: g.locale_code,
        permissions: patternsByRole.get(g.role_id) ?? [],
      })),
    });

    await next();
  };
}
