import type { Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

export const migration0004Locales: Migration = {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .createTable('locales')
      .addColumn('id', 'uuid', (col) => col.primaryKey())
      .addColumn('project_id', 'uuid', (col) =>
        col.notNull().references('projects.id').onDelete('cascade'),
      )
      .addColumn('code', 'text', (col) => col.notNull())
      .addUniqueConstraint('locales_project_id_code_unique', ['project_id', 'code'])
      .execute();
  },

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('locales').execute();
  },
};
