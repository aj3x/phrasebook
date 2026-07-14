import { describe, expect, test } from 'bun:test';
import { createMigratedTestDb } from '@phrasebook/db/test-utils';
import { createApp } from '../src/app';
import { createAuth } from '../src/auth';
import { PostgresStore } from '../src/store/postgres';

async function createTestApp() {
  const db = await createMigratedTestDb();
  const auth = createAuth({
    db,
    secret: 'test-secret-at-least-32-characters-long',
    baseURL: 'http://localhost:3000',
  });
  const app = createApp(new PostgresStore(db), auth);
  return { app, db };
}

describe('better-auth wiring', () => {
  test('sign-up creates a user row and returns a session cookie', async () => {
    const { app, db } = await createTestApp();

    const res = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        password: 'correct-horse-battery-staple',
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toBeTruthy();

    const users = await db.selectFrom('user').selectAll().execute();
    expect(users).toHaveLength(1);
    expect(users[0]?.email).toBe('ada@example.com');

    await db.destroy();
  });

  test('sign-in with correct credentials returns a session cookie', async () => {
    const { app, db } = await createTestApp();

    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        password: 'correct-horse-battery-staple',
      }),
    });

    const res = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'ada@example.com',
        password: 'correct-horse-battery-staple',
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toBeTruthy();

    await db.destroy();
  });

  test('sign-in with the wrong password is rejected', async () => {
    const { app, db } = await createTestApp();

    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        password: 'correct-horse-battery-staple',
      }),
    });

    const res = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'ada@example.com',
        password: 'wrong-password',
      }),
    });

    expect(res.status).toBe(401);

    await db.destroy();
  });
});
