/**
 * The permission grammar (M3 plan, "The permission model"). A permission is
 * `"<resource>:<action>"`, where `*` is a valid wildcard in *either*
 * position: `project:view`, `project:*`, `*:view`, `*:*`.
 *
 * Pure by design -- no DB, no HTTP. The DB-backed and middleware layers
 * (steps 4-5) sit on top of this; keeping the matcher here means the
 * grammar can be exhaustively tested without a database.
 */

export interface Permission {
  resource: string;
  action: string;
}

/**
 * Segments are lowercase snake_case (`role_assignment`, `send_back`) or the
 * bare wildcard. Anything looser would let a typo'd grant sit in the
 * database matching nothing, which is the failure mode this validation
 * exists to prevent.
 */
const SEGMENT = String.raw`(\*|[a-z][a-z0-9_]*)`;
const PERMISSION_PATTERN = new RegExp(`^${SEGMENT}:${SEGMENT}$`);

export function parsePermission(pattern: string): Permission {
  const [, resource, action] = PERMISSION_PATTERN.exec(pattern) ?? [];
  if (resource === undefined || action === undefined) {
    throw new Error(
      `Invalid permission "${pattern}": expected "<resource>:<action>", each segment lowercase snake_case or "*"`,
    );
  }

  return { resource, action };
}

/**
 * Does a held grant satisfy a required permission?
 *
 * The required side is always concrete -- route code asks for
 * `translation:save`, never for a wildcard -- so a wildcard there is a
 * programming error, not a permissive query. Rejecting it keeps the
 * matcher total and order-independent, which is what lets the model stay
 * additive with no precedence rules (§D4: there are no deny rules, so a
 * user is allowed something if *any* held pattern matches).
 */
export function matches(held: string, required: string): boolean {
  return permissionSatisfies(parsePermission(held), parsePermission(required));
}

/**
 * The wildcard rule on already-parsed permissions -- the hot path for the
 * session's in-memory grants, which are stored parsed (`RoleGrant.permissions`)
 * and would otherwise be re-serialized and re-parsed on every check. `matches`
 * is the string-input wrapper over this.
 */
export function permissionSatisfies(held: Permission, required: Permission): boolean {
  if (required.resource === '*' || required.action === '*') {
    throw new Error(
      `Required permission "${required.resource}:${required.action}" must be concrete, not a wildcard`,
    );
  }

  return (
    (held.resource === required.resource || held.resource === '*') &&
    (held.action === required.action || held.action === '*')
  );
}
