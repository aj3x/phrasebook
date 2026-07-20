import type { AuthContext } from './middleware/session';

/**
 * Shared Hono context type: every route module and middleware reads/writes
 * the same `authContext` variable set by session.ts's middleware. One
 * definition so route files don't each redeclare it.
 */
export type Env = { Variables: { authContext: AuthContext | null } };
