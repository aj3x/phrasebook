import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

export const migration0005Namespaces: Migration = {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .createTable('namespaces')
      .addColumn('id', 'uuid', (col) => col.primaryKey())
      .addColumn('project_id', 'uuid', (col) =>
        col.notNull().references('projects.id').onDelete('cascade'),
      )
      .addColumn('name', 'text', (col) => col.notNull())
      .addColumn('authority', 'text', (col) =>
        col.notNull().check(sql`authority in ('code', 'platform')`),
      )
      .addUniqueConstraint('namespaces_project_id_name_unique', ['project_id', 'name'])
      .execute();
  },

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('namespaces').execute();
  },
};
