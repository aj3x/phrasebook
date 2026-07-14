import type { AuthContext } from './session';

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
 * alone. No route uses this yet -- ready for the editor API (M2 steps
 * 7+) once it has real project/locale-scoped endpoints to protect.
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
