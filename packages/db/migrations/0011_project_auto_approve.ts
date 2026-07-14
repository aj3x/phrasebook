import type { Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

/**
 * §5's default is translator auto-approve (a save goes straight to
 * `approved`); disabling it requires a separate reviewer. Defaults to true
 * so existing/seeded projects keep today's implicit behavior.
 */
export const migration0011ProjectAutoApprove: Migration = {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .alterTable('projects')
      .addColumn('auto_approve', 'boolean', (col) => col.notNull().defaultTo(true))
      .execute();
  },

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('projects').dropColumn('auto_approve').execute();
  },
};
