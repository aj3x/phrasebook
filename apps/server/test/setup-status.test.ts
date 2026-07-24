import { describe, expect, test } from 'bun:test';
import { createMigratedTestDb } from '@phrasebook/db/test-utils';
import { createApp } from '../src/app';
import { createAuth } from '../src/auth';
import { PostgresStore } from '../src/store/postgres';

const ORG_ID = '11111111-1111-1111-1111-111111111111';

async function createTestSetup() {
  const db = await createMigratedTestDb();
  const auth = createAuth({
    db,
    secret: 'test-secret-at-least-32-characters-long',
    baseURL: 'http://localhost:3000',
  });
  const app = createApp(new PostgresStore(db), auth, db);
  return { db, app };
}

describe('GET /v1/setup/status', () => {
  test('reports needsSetup: true on an empty instance', async () => {
    const { db, app } = await createTestSetup();

    const res = await app.request('/v1/setup/status');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ needsSetup: true });

    await db.destroy();
  });

  test('reports needsSetup: false once an org exists', async () => {
    const { db, app } = await createTestSetup();
    await db.insertInto('organizations').values({ id: ORG_ID, name: 'Acme' }).execute();

    const res = await app.request('/v1/setup/status');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ needsSetup: false });

    await db.destroy();
  });

  test('is public: no session required, and leaks nothing but the boolean', async () => {
    const { db, app } = await createTestSetup();
    await db.insertInto('organizations').values({ id: ORG_ID, name: 'Secret Corp' }).execute();

    const res = await app.request('/v1/setup/status');

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['needsSetup']);
    expect(JSON.stringify(body)).not.toContain('Secret Corp');

    await db.destroy();
  });
});
