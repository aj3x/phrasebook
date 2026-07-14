import type { Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

/**
 * §D4/F3's revoke-everything mechanism: additive-only permissions have no
 * deny rules, so "suspend this user immediately" needs its own flag rather
 * than trying to express it as a role grant. Checked first (short-circuits)
 * by apps/server's requireRole middleware, ahead of any role/scope check.
 */
export const migration0010UserLocked: Migration = {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .alterTable('user')
      .addColumn('locked', 'boolean', (col) => col.notNull().defaultTo(false))
      .execute();
  },

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('user').dropColumn('locked').execute();
  },
};
