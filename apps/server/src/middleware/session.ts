import type { Database } from '@phrasebook/db';
import type { MiddlewareHandler } from 'hono';
import type { Kysely } from 'kysely';
import type { Auth } from '../auth';

export interface RoleGrant {
  role: string;
  /** Three independent scope dimensions; null means "all" for that one. */
  workspaceId: string | null;
  projectId: string | null;
  localeCode: string | null;
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
 * separate requireRole()-style middleware applied per-route (M2 step 3),
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
        'roles.name as role',
        'role_assignments.workspace_id',
        'role_assignments.project_id',
        'role_assignments.locale_code',
      ])
      .where('role_assignments.user_id', '=', session.user.id)
      .execute();

    c.set('authContext', {
      userId: session.user.id,
      roles: grants.map((g) => ({
        role: g.role,
        workspaceId: g.workspace_id,
        projectId: g.project_id,
        localeCode: g.locale_code,
      })),
    });

    await next();
  };
}
