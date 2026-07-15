import type { Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

/**
 * Separation-of-duties for §5's manual-review flow: when auto_approve is
 * off, the reviewer approving a translation must not be the same user
 * whose save produced its current text. Enforced in the store by comparing
 * the current authContext.userId against this column. Nullable so that
 * pre-migration and seed/putTranslation rows (no editor identity to
 * record) are grandfathered in -- they can still be approved.
 *
 * ON DELETE SET NULL: deleting a user shouldn't cascade-delete
 * translations they last touched; leaving the row with a null editor
 * lets the SoD check gracefully allow approval to unblock the flow.
 */
export const migration0012TranslationLastEditor: Migration = {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .alterTable('translations')
      .addColumn('last_editor_id', 'text', (col) => col.references('user.id').onDelete('set null'))
      .execute();
  },

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('translations').dropColumn('last_editor_id').execute();
  },
};
