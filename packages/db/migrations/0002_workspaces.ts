import type { Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

export const migration0002Workspaces: Migration = {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .createTable('workspaces')
      .addColumn('id', 'uuid', (col) => col.primaryKey())
      .addColumn('org_id', 'uuid', (col) =>
        col.notNull().references('organizations.id').onDelete('cascade'),
      )
      .addColumn('name', 'text', (col) => col.notNull())
      .execute();
  },

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('workspaces').execute();
  },
};
