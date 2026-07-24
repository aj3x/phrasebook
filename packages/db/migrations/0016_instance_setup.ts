import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

/**
 * The one-time bootstrap singleton (M3 Phase B step 10). A freshly hosted
 * instance is set up exactly once -- `POST /v1/setup` creates the first Owner
 * and org -- and that must be race-safe: two concurrent setup calls cannot
 * both create an owner (DoD #6). "Check no org exists, then insert" is
 * textbook TOCTOU, so the guarantee is enforced *at the database* here rather
 * than in application logic.
 *
 * The mechanism: this table always holds at most one row, written with the
 * fixed sentinel primary key `INSTANCE_SETUP_ID`. The setup transaction
 * inserts that row alongside the org/workspace/owner-assignment; a second
 * racing transaction inserting the same primary key violates the constraint
 * and rolls back, so the loser gets a clean 409 while the winner's owner is
 * the only one that ever commits. Recording `owner_user_id`/`org_id` also
 * makes the row a small audit of who bootstrapped the instance and when.
 */
export const INSTANCE_SETUP_ID = '00000000-0000-0000-0000-0000000000e1';

export const migration0016InstanceSetup: Migration = {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .createTable('instance_setup')
      .addColumn('id', 'uuid', (col) => col.primaryKey())
      .addColumn('owner_user_id', 'text', (col) =>
        col.notNull().references('user.id').onDelete('cascade'),
      )
      .addColumn('org_id', 'uuid', (col) =>
        col.notNull().references('organizations.id').onDelete('cascade'),
      )
      .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .execute();
  },

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('instance_setup').execute();
  },
};
