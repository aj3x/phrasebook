import type { Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

/**
 * Adds `workspace_id` as a third scope dimension on role_assignments,
 * alongside project_id/locale_code and following the same rule: nullable,
 * NULL means "all" (§F3).
 *
 * Behaviour-neutral today -- M3 creates exactly one implicit workspace, so
 * every assignment is NULL-or-that-workspace. It's carried now because
 * retrofitting a scope dimension once real grants exist is a brutal
 * migration, while carrying it is nearly free (the same argument D1's
 * tenant column already won). M7, when workspaces become user-facing, is
 * then a feature milestone rather than a migration of live grant data.
 */
export const migration0015RoleAssignmentWorkspaceScope: Migration = {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .alterTable('role_assignments')
      .addColumn('workspace_id', 'uuid', (col) =>
        col.references('workspaces.id').onDelete('cascade'),
      )
      .execute();
  },

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('role_assignments').dropColumn('workspace_id').execute();
  },
};
