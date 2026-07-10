import type { Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

export const migration0001Organizations: Migration = {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .createTable('organizations')
      .addColumn('id', 'uuid', (col) => col.primaryKey())
      .addColumn('name', 'text', (col) => col.notNull())
      .execute();
  },

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('organizations').execute();
  },
};
