import type { Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

export const migration0006Keys: Migration = {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .createTable('keys')
      .addColumn('id', 'uuid', (col) => col.primaryKey())
      .addColumn('namespace_id', 'uuid', (col) =>
        col.notNull().references('namespaces.id').onDelete('cascade'),
      )
      .addColumn('name', 'text', (col) => col.notNull())
      .addColumn('source_text', 'text', (col) => col.notNull())
      .addColumn('source_hash', 'text', (col) => col.notNull())
      .addUniqueConstraint('keys_namespace_id_name_unique', ['namespace_id', 'name'])
      .execute();
  },

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('keys').execute();
  },
};
