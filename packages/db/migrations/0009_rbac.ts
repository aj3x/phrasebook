import type { Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

/**
 * Fixed IDs for the six built-in roles (§F3) so later migrations, seeds,
 * and application code can reference them without a name lookup. No
 * custom-role *creation* UI in M2 -- a custom role is just another row
 * here with is_custom = true, added later.
 *
 * `owner` is added by migrations/0014_permissions.ts (M3 Phase A), not
 * seeded here -- kept in this const so every built-in role ID lives in one
 * place regardless of which migration inserts the row.
 */
export const BUILT_IN_ROLE_IDS = {
  admin: '10000000-0000-0000-0000-000000000001',
  developer: '10000000-0000-0000-0000-000000000002',
  translator: '10000000-0000-0000-0000-000000000003',
  reviewer: '10000000-0000-0000-0000-000000000004',
  viewer: '10000000-0000-0000-0000-000000000005',
  owner: '10000000-0000-0000-0000-000000000006',
} as const;

export const migration0009Rbac: Migration = {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .createTable('roles')
      .addColumn('id', 'uuid', (col) => col.primaryKey())
      .addColumn('name', 'text', (col) => col.notNull().unique())
      .addColumn('is_custom', 'boolean', (col) => col.notNull().defaultTo(false))
      .execute();

    await db
      .insertInto('roles')
      .values([
        { id: BUILT_IN_ROLE_IDS.admin, name: 'Admin' },
        { id: BUILT_IN_ROLE_IDS.developer, name: 'Developer' },
        { id: BUILT_IN_ROLE_IDS.translator, name: 'Translator' },
        { id: BUILT_IN_ROLE_IDS.reviewer, name: 'Reviewer' },
        { id: BUILT_IN_ROLE_IDS.viewer, name: 'Viewer' },
      ])
      .execute();

    // Scope columns are nullable by design: NULL means "all" (§F3
    // language-dependent roles -- locale/project are the scope dimensions;
    // omitting either widens the grant rather than narrowing it).
    await db.schema
      .createTable('role_assignments')
      .addColumn('id', 'uuid', (col) => col.primaryKey())
      .addColumn('user_id', 'text', (col) =>
        col.notNull().references('user.id').onDelete('cascade'),
      )
      .addColumn('role_id', 'uuid', (col) =>
        col.notNull().references('roles.id').onDelete('cascade'),
      )
      .addColumn('project_id', 'uuid', (col) => col.references('projects.id').onDelete('cascade'))
      .addColumn('locale_code', 'text')
      .execute();
    await db.schema
      .createIndex('role_assignments_user_id_index')
      .on('role_assignments')
      .column('user_id')
      .execute();
  },

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('role_assignments').execute();
    await db.schema.dropTable('roles').execute();
  },
};
