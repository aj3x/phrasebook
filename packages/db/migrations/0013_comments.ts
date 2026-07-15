import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

/**
 * The Comment/Thread entity (§4, §11): discussion on a key or a specific
 * translation. This IS the "TMS notes" entity -- there is no separate
 * notes field (§4 metadata-authority: process metadata is always
 * platform-owned and reuses this entity, so no field is co-owned).
 *
 * - `locale_id` NULL means the comment is about the key itself
 *   (locale-agnostic); a set locale scopes it to that locale's
 *   translation. Cascades on locale delete (the translation it discussed
 *   is gone too).
 * - `author_id` ON DELETE SET NULL: deleting a user shouldn't erase the
 *   discussion history; the comment survives with a null author, same
 *   posture as translations.last_editor_id.
 * - Comments cascade on key delete (a deprecated/removed key's thread
 *   goes with it).
 */
export const migration0013Comments: Migration = {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .createTable('comments')
      .addColumn('id', 'uuid', (col) => col.primaryKey())
      .addColumn('key_id', 'uuid', (col) => col.notNull().references('keys.id').onDelete('cascade'))
      .addColumn('locale_id', 'uuid', (col) => col.references('locales.id').onDelete('cascade'))
      .addColumn('author_id', 'text', (col) => col.references('user.id').onDelete('set null'))
      .addColumn('body', 'text', (col) => col.notNull())
      .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .execute();
  },

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('comments').execute();
  },
};
