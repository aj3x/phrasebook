import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Migration } from 'kysely/migration';

/**
 * Optional first-run questionnaire capture (M3 Phase B step 12). The setup
 * wizard's survey step is skippable and nothing in M3 keys off this data --
 * it's captured for future defaults/tour work, so the payload is a free-form
 * JSON blob rather than typed columns that would ossify a question set still
 * being figured out.
 *
 * Scoped to the submitting user (the owner during onboarding); cascades on
 * user delete since a lone survey response has no meaning without its author.
 */
export const migration0017OnboardingResponses: Migration = {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .createTable('onboarding_responses')
      .addColumn('id', 'uuid', (col) => col.primaryKey())
      .addColumn('user_id', 'text', (col) =>
        col.notNull().references('user.id').onDelete('cascade'),
      )
      .addColumn('payload', 'jsonb', (col) => col.notNull())
      .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
      .execute();
  },

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('onboarding_responses').execute();
  },
};
