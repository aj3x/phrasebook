import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

export const migration0007Translations: Migration = {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .createTable('translations')
      .addColumn('id', 'uuid', (col) => col.primaryKey())
      .addColumn('key_id', 'uuid', (col) => col.notNull().references('keys.id').onDelete('cascade'))
      .addColumn('locale_id', 'uuid', (col) =>
        col.notNull().references('locales.id').onDelete('cascade'),
      )
      .addColumn('target_text', 'text', (col) => col.notNull())
      .addColumn('status', 'text', (col) => col.notNull())
      .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .addColumn('version', 'integer', (col) => col.notNull().defaultTo(0))
      .addUniqueConstraint('translations_key_id_locale_id_unique', ['key_id', 'locale_id'])
      .execute();
  },

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('translations').execute();
  },
};
