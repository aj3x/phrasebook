import type { Database } from '@phrasebook/db';
import { Hono } from 'hono';
import type { Kysely } from 'kysely';
import type { Auth } from '../auth';
import type { Env } from '../types';

/**
 * First-run onboarding backend (M3 Phase B). A freshly hosted instance has
 * no org, no owner, no way in -- these routes are the seed-free bootstrap the
 * setup wizard drives (plan/03-milestone-3-onboarding.md).
 *
 * `GET /v1/setup/status` is the one public, always-available probe: the editor
 * calls it on load to decide wizard-vs-login. It returns *only* a boolean --
 * never the org name or owner email -- so an unauthenticated caller learns
 * whether setup is needed and nothing else (Security spotlight, §"status is
 * public").
 */
export function createSetupRoutes(_auth: Auth, db: Kysely<Database>) {
  const app = new Hono<Env>();

  app.get('/setup/status', async (c) => {
    const org = await db.selectFrom('organizations').select('id').limit(1).executeTakeFirst();
    return c.json({ needsSetup: org === undefined });
  });

  return app;
}
