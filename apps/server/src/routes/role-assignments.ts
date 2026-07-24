import { BUILT_IN_ROLE_IDS, type Database } from '@phrasebook/db';
import { Hono } from 'hono';
import type { Kysely } from 'kysely';
import { hasPermission, requireUnlocked } from '../middleware/permission';
import type { AuthContext } from '../middleware/session';
import { LastOwnerError, assertNotLastOwner } from '../owner-guard';
import { parsePermission, permissionSatisfies } from '../permissions';
import type { Env } from '../types';

/**
 * Assign / revoke a role for a user (M3 Phase A step 8). This is the surface
 * that makes `role_assignment:*` real, so decision 1b ("Admins assign roles
 * within their workspace") is enforced rather than merely granted. RBAC tables
 * are queried through `db` directly, as the session middleware and permission
 * gates already do -- role assignment isn't part of the translation-domain
 * Store abstraction.
 */

interface AssignmentScope {
  workspaceId: string | null;
  projectId: string | null;
  localeCode: string | null;
}

/**
 * Granting *containment* -- deliberately distinct from hasPermission's "does my
 * grant reach this resource" check. A caller may create or revoke an assignment
 * scoped to S only while holding `required` under a grant whose scope contains
 * S in every dimension: a NULL ("all") grant contains anything, a concrete
 * grant contains only the identical value, and a concrete grant does NOT
 * contain NULL. That last case is the point -- a workspace-scoped Admin cannot
 * mint or revoke an instance-wide (all-workspaces) assignment, only ones inside
 * its own workspace.
 */
function dimensionContains(granted: string | null, target: string | null): boolean {
  return granted === null || granted === target;
}

function canActOnScope(ctx: AuthContext, required: string, target: AssignmentScope): boolean {
  const req = parsePermission(required);
  return ctx.roles.some(
    (g) =>
      dimensionContains(g.workspaceId, target.workspaceId) &&
      dimensionContains(g.projectId, target.projectId) &&
      dimensionContains(g.localeCode, target.localeCode) &&
      g.permissions.some((h) => permissionSatisfies(h, req)),
  );
}

function scopeFromBody(body: Record<string, unknown>): AssignmentScope {
  return {
    workspaceId: typeof body.workspaceId === 'string' ? body.workspaceId : null,
    projectId: typeof body.projectId === 'string' ? body.projectId : null,
    localeCode: typeof body.localeCode === 'string' ? body.localeCode : null,
  };
}

export function createRoleAssignmentsRoutes(db: Kysely<Database>) {
  const app = new Hono<Env>();

  app.post('/role-assignments', async (c) => {
    const actor = await requireUnlocked(c, db);
    if (actor instanceof Response) return actor;

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const { userId, role } = body;
    if (typeof userId !== 'string' || typeof role !== 'string') {
      return c.json({ error: 'userId and role are required' }, 400);
    }
    const target = scopeFromBody(body);

    const roleRow = await db
      .selectFrom('roles')
      .select(['id', 'name'])
      .where('name', '=', role)
      .executeTakeFirst();
    if (!roleRow) {
      return c.json({ error: `Unknown role "${role}"` }, 400);
    }

    const userRow = await db
      .selectFrom('user')
      .select('id')
      .where('id', '=', userId)
      .executeTakeFirst();
    if (!userRow) {
      return c.json({ error: 'User not found' }, 404);
    }

    // Minting an Owner is reserved to role:* holders (only Owner), regardless
    // of role_assignment grants -- so an Admin with role_assignment:* still
    // can't escalate anyone (itself included) to Owner. Checked before the
    // role_assignment gate so the more privileged failure wins the 403.
    if (roleRow.id === BUILT_IN_ROLE_IDS.owner && !hasPermission(actor, 'role:create')) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    if (!canActOnScope(actor, 'role_assignment:create', target)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    // No DB unique constraint on the (user, role, scope) tuple -- duplicates
    // are harmless under the additive model, but a redundant grant is
    // confusing, so reject it for clean UX (best-effort; a benign race can't
    // create a security problem, only a duplicate row).
    const duplicate = await db
      .selectFrom('role_assignments')
      .select('id')
      .where('user_id', '=', userId)
      .where('role_id', '=', roleRow.id)
      .where((eb) =>
        eb.and([
          target.workspaceId === null
            ? eb('workspace_id', 'is', null)
            : eb('workspace_id', '=', target.workspaceId),
          target.projectId === null
            ? eb('project_id', 'is', null)
            : eb('project_id', '=', target.projectId),
          target.localeCode === null
            ? eb('locale_code', 'is', null)
            : eb('locale_code', '=', target.localeCode),
        ]),
      )
      .executeTakeFirst();
    if (duplicate) {
      return c.json({ error: 'That role is already assigned at this scope' }, 409);
    }

    const id = crypto.randomUUID();
    await db
      .insertInto('role_assignments')
      .values({
        id,
        user_id: userId,
        role_id: roleRow.id,
        workspace_id: target.workspaceId,
        project_id: target.projectId,
        locale_code: target.localeCode,
      })
      .execute();

    return c.json({ id, userId, role: roleRow.name, ...target }, 201);
  });

  app.delete('/role-assignments/:id', async (c) => {
    const actor = await requireUnlocked(c, db);
    if (actor instanceof Response) return actor;

    const id = c.req.param('id');
    const row = await db
      .selectFrom('role_assignments')
      .select(['id', 'user_id', 'role_id', 'workspace_id', 'project_id', 'locale_code'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) {
      return c.json({ error: 'Not found' }, 404);
    }

    const target: AssignmentScope = {
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      localeCode: row.locale_code,
    };
    const isOwner = row.role_id === BUILT_IN_ROLE_IDS.owner;

    // Symmetric with assignment: stripping an Owner is a role:* action, so an
    // Admin can't demote the instance's Owner even with role_assignment:*.
    if (isOwner && !hasPermission(actor, 'role:create')) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    if (!canActOnScope(actor, 'role_assignment:revoke', target)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    try {
      await db.transaction().execute(async (trx) => {
        // Last-Owner protection runs inside the tx so the count and the delete
        // are atomic (DoD #10). Only relevant when revoking an Owner grant --
        // revoking any other role never changes the Owner count.
        if (isOwner) {
          await assertNotLastOwner(trx, row.user_id, 'demote');
        }
        await trx.deleteFrom('role_assignments').where('id', '=', id).execute();
      });
    } catch (err) {
      if (err instanceof LastOwnerError) {
        return c.json({ error: err.message }, 409);
      }
      throw err;
    }

    return c.json({ revoked: true });
  });

  return app;
}
