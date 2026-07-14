import type { Database } from '@phrasebook/db';
import type { MiddlewareHandler } from 'hono';
import type { Kysely } from 'kysely';
import type { AuthContext } from './session';

type Env = { Variables: { authContext: AuthContext | null } };

/**
 * Additive-only (§D4): a request passes if the signed-in user has ANY role
 * assignment matching any of `roleNames`, regardless of scope -- there are
 * no deny rules, so this is just "does at least one grant match." Scope
 * (project/locale) matching is a separate concern, deliberately not baked
 * in here -- see hasScopedRole in scope.ts, used once a route actually
 * needs project/locale-scoped checks.
 *
 * Checks the locked flag first and short-circuits to 403 regardless of
 * role -- the only revoke-everything mechanism (§D4/F3), since additive-
 * only permissions have no other way to say "not anymore."
 */
export function requireRole(db: Kysely<Database>, roleNames: string[]): MiddlewareHandler<Env> {
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

    const hasMatch = authContext.roles.some((grant) => roleNames.includes(grant.role));
    if (!hasMatch) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    await next();
  };
}
