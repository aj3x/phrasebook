import { describe, expect, test } from 'bun:test';
import { createMigratedTestDb } from '@phrasebook/db/test-utils';
import { createApp } from '../src/app';
import { createAuth } from '../src/auth';
import type { TranslationStatus } from '../src/status';
import type {
  AccessibleProject,
  BundleResult,
  ProjectAccessScope,
  PutTranslationInput,
  SaveTranslationInput,
  Store,
  TranslationRef,
} from '../src/store/store';

class FakeStore implements Store {
  constructor(private readonly bundles: Record<string, BundleResult> = {}) {}

  async getBundle(
    project: string,
    locale: string,
    namespace: string,
  ): Promise<BundleResult | undefined> {
    return this.bundles[`${project}/${locale}/${namespace}`];
  }

  async putTranslation(_input: PutTranslationInput): Promise<void> {
    throw new Error('not used in these tests');
  }

  async saveTranslation(_input: SaveTranslationInput): Promise<TranslationStatus> {
    throw new Error('not used in these tests');
  }

  async claimTranslationForReview(_ref: TranslationRef): Promise<TranslationStatus> {
    throw new Error('not used in these tests');
  }

  async approveTranslation(_ref: TranslationRef): Promise<TranslationStatus> {
    throw new Error('not used in these tests');
  }

  async sendTranslationBack(_ref: TranslationRef, _comment: string): Promise<TranslationStatus> {
    throw new Error('not used in these tests');
  }

  async listAccessibleProjects(_scope: ProjectAccessScope): Promise<AccessibleProject[]> {
    throw new Error('not used in these tests');
  }
}

// These tests only exercise the /v1/* runtime routes, not auth -- but
// createApp needs a real Auth instance (and its db) to mount, so build one
// against a throwaway migrated db rather than hand-faking better-auth's
// large inferred return type.
async function testAuth() {
  const db = await createMigratedTestDb();
  const auth = createAuth({
    db,
    secret: 'test-secret-at-least-32-characters-long',
    baseURL: 'http://localhost:3000',
  });
  return { auth, db };
}

describe('GET /health', () => {
  test('returns 200 OK', async () => {
    const { auth, db } = await testAuth();
    const app = createApp(new FakeStore(), auth, db);

    const res = await app.request('/health');

    expect(res.status).toBe(200);
  });
});

describe('GET /v1/runtime/:project/:locale/:namespace', () => {
  test('returns the bundle as JSON with an ETag and Cache-Control header', async () => {
    const { auth, db } = await testAuth();
    const app = createApp(
      new FakeStore({
        'demo/fr/common': {
          keys: { 'home.hero.title': 'Bienvenue' },
          version: 3,
          etag: '"3"',
        },
      }),
      auth,
      db,
    );

    const res = await app.request('/v1/runtime/demo/fr/common');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      locale: 'fr',
      namespace: 'common',
      version: 3,
      keys: { 'home.hero.title': 'Bienvenue' },
    });
    expect(res.headers.get('ETag')).toBe('"3"');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60, must-revalidate');
  });

  test('returns 404 when the project, locale, or namespace is unknown', async () => {
    const { auth, db } = await testAuth();
    const app = createApp(new FakeStore(), auth, db);

    const res = await app.request('/v1/runtime/nope/fr/common');

    expect(res.status).toBe(404);
  });

  test('returns 304 with no body when If-None-Match matches the current etag', async () => {
    const { auth, db } = await testAuth();
    const app = createApp(
      new FakeStore({
        'demo/fr/common': {
          keys: { 'home.hero.title': 'Bienvenue' },
          version: 3,
          etag: '"3"',
        },
      }),
      auth,
      db,
    );

    const res = await app.request('/v1/runtime/demo/fr/common', {
      headers: { 'If-None-Match': '"3"' },
    });

    expect(res.status).toBe(304);
    expect(await res.text()).toBe('');
  });

  test('returns 200 with the full body when If-None-Match is stale', async () => {
    const { auth, db } = await testAuth();
    const app = createApp(
      new FakeStore({
        'demo/fr/common': {
          keys: { 'home.hero.title': 'Bienvenue' },
          version: 3,
          etag: '"3"',
        },
      }),
      auth,
      db,
    );

    const res = await app.request('/v1/runtime/demo/fr/common', {
      headers: { 'If-None-Match': '"2"' },
    });

    expect(res.status).toBe(200);
  });

  test('allows CORS from the demo-web dev origin', async () => {
    const { auth, db } = await testAuth();
    const app = createApp(
      new FakeStore({
        'demo/fr/common': { keys: {}, version: 0, etag: '"0"' },
      }),
      auth,
      db,
    );

    const res = await app.request('/v1/runtime/demo/fr/common', {
      headers: { Origin: 'http://localhost:5173' },
    });

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });
});
