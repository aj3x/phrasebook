import type { Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

export const migration0003Projects: Migration = {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .createTable('projects')
      .addColumn('id', 'uuid', (col) => col.primaryKey())
      .addColumn('workspace_id', 'uuid', (col) =>
        col.notNull().references('workspaces.id').onDelete('cascade'),
      )
      .addColumn('name', 'text', (col) => col.notNull())
      .addColumn('source_locale', 'text', (col) => col.notNull())
      .execute();
  },

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('projects').execute();
  },
};
