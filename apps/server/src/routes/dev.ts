import type { Database } from '@phrasebook/db';
import { Hono } from 'hono';
import type { Kysely } from 'kysely';
import type { Auth } from '../auth';
import { seedAdminUser } from '../seed';
import type { Env } from '../types';

/**
 * Unauthenticated "make yourself Admin" bootstrap -- a stand-in for M3's
 * real first-run setup wizard (plan/03-milestone-3-onboarding.md), which
 * deletes this route outright once `POST /v1/setup` exists. Do not let
 * this reach an exposed deployment.
 */
export function createDevRoutes(auth: Auth, db: Kysely<Database>) {
  const app = new Hono<Env>();

  app.get('/temp/seed', async (c) => {
    const result = await seedAdminUser(auth, db, 'hey@aj3x.dev', 'asdfasdf');

    return c.json({ result });
  });

  return app;
}
