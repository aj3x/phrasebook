import { describe, expect, test } from 'bun:test';
import { createMigratedTestDb } from '@phrasebook/db/test-utils';
import { PostgresStore } from '../../src/store/postgres';
import { SaveConflictError } from '../../src/store/store';

async function seedDemoProject(db: Awaited<ReturnType<typeof createMigratedTestDb>>) {
  await db
    .insertInto('organizations')
    .values({ id: '11111111-1111-1111-1111-111111111111', name: 'Acme' })
    .execute();
  await db
    .insertInto('workspaces')
    .values({
      id: '22222222-2222-2222-2222-222222222222',
      org_id: '11111111-1111-1111-1111-111111111111',
      name: 'Acme Marketing',
    })
    .execute();
  await db
    .insertInto('projects')
    .values({
      id: '33333333-3333-3333-3333-333333333333',
      workspace_id: '22222222-2222-2222-2222-222222222222',
      name: 'demo',
      source_locale: 'en',
    })
    .execute();
  await db
    .insertInto('locales')
    .values({
      id: '44444444-4444-4444-4444-444444444444',
      project_id: '33333333-3333-3333-3333-333333333333',
      code: 'fr',
    })
    .execute();
  await db
    .insertInto('namespaces')
    .values({
      id: '66666666-6666-6666-6666-666666666666',
      project_id: '33333333-3333-3333-3333-333333333333',
      name: 'common',
      authority: 'code',
    })
    .execute();
}

describe('PostgresStore.getBundle', () => {
  test('returns keys, version, and etag for translated keys', async () => {
    const db = await createMigratedTestDb();
    await seedDemoProject(db);

    await db
      .insertInto('keys')
      .values({
        id: '88888888-8888-8888-8888-888888888888',
        namespace_id: '66666666-6666-6666-6666-666666666666',
        name: 'home.hero.title',
        source_text: 'Welcome',
        source_hash: 'deadbeef',
      })
      .execute();
    await db
      .insertInto('translations')
      .values({
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        key_id: '88888888-8888-8888-8888-888888888888',
        locale_id: '44444444-4444-4444-4444-444444444444',
        target_text: 'Bienvenue',
        status: 'published',
        version: 3,
      })
      .execute();

    const store = new PostgresStore(db);
    const bundle = await store.getBundle('demo', 'fr', 'common');

    expect(bundle).toEqual({
      keys: { 'home.hero.title': 'Bienvenue' },
      version: 3,
      etag: '"3"',
    });

    await db.destroy();
  });

  test('omits keys with no translation for the requested locale', async () => {
    const db = await createMigratedTestDb();
    await seedDemoProject(db);

    await db
      .insertInto('keys')
      .values([
        {
          id: '88888888-8888-8888-8888-888888888888',
          namespace_id: '66666666-6666-6666-6666-666666666666',
          name: 'home.hero.title',
          source_text: 'Welcome',
          source_hash: 'deadbeef',
        },
        {
          id: '99999999-9999-9999-9999-999999999999',
          namespace_id: '66666666-6666-6666-6666-666666666666',
          name: 'home.hero.subtitle',
          source_text: 'Subtitle',
          source_hash: 'cafed00d',
        },
      ])
      .execute();
    // Only the first key has an "fr" translation; the second should be
    // omitted from the bundle so the client can fall back (F10).
    await db
      .insertInto('translations')
      .values({
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        key_id: '88888888-8888-8888-8888-888888888888',
        locale_id: '44444444-4444-4444-4444-444444444444',
        target_text: 'Bienvenue',
        status: 'published',
      })
      .execute();

    const store = new PostgresStore(db);
    const bundle = await store.getBundle('demo', 'fr', 'common');

    expect(bundle?.keys).toEqual({ 'home.hero.title': 'Bienvenue' });

    await db.destroy();
  });

  test('returns version 0 and a matching etag when no translations exist yet', async () => {
    const db = await createMigratedTestDb();
    await seedDemoProject(db);

    const store = new PostgresStore(db);
    const bundle = await store.getBundle('demo', 'fr', 'common');

    expect(bundle).toEqual({ keys: {}, version: 0, etag: '"0"' });

    await db.destroy();
  });

  test('returns undefined for an unknown project, locale, or namespace', async () => {
    const db = await createMigratedTestDb();
    await seedDemoProject(db);

    const store = new PostgresStore(db);

    expect(await store.getBundle('nope', 'fr', 'common')).toBeUndefined();
    expect(await store.getBundle('demo', 'de', 'common')).toBeUndefined();
    expect(await store.getBundle('demo', 'fr', 'nope')).toBeUndefined();

    await db.destroy();
  });
});

describe('PostgresStore.putTranslation', () => {
  test('inserts a new translation, visible via getBundle', async () => {
    const db = await createMigratedTestDb();
    await seedDemoProject(db);
    await db
      .insertInto('keys')
      .values({
        id: '88888888-8888-8888-8888-888888888888',
        namespace_id: '66666666-6666-6666-6666-666666666666',
        name: 'home.hero.title',
        source_text: 'Welcome',
        source_hash: 'deadbeef',
      })
      .execute();

    const store = new PostgresStore(db);
    await store.putTranslation({
      project: 'demo',
      namespace: 'common',
      locale: 'fr',
      key: 'home.hero.title',
      targetText: 'Bienvenue',
      status: 'published',
    });

    const bundle = await store.getBundle('demo', 'fr', 'common');
    expect(bundle?.keys).toEqual({ 'home.hero.title': 'Bienvenue' });
    expect(bundle?.version).toBe(0);

    await db.destroy();
  });

  test('upserts an existing translation and bumps its version', async () => {
    const db = await createMigratedTestDb();
    await seedDemoProject(db);
    await db
      .insertInto('keys')
      .values({
        id: '88888888-8888-8888-8888-888888888888',
        namespace_id: '66666666-6666-6666-6666-666666666666',
        name: 'home.hero.title',
        source_text: 'Welcome',
        source_hash: 'deadbeef',
      })
      .execute();

    const store = new PostgresStore(db);
    await store.putTranslation({
      project: 'demo',
      namespace: 'common',
      locale: 'fr',
      key: 'home.hero.title',
      targetText: 'Bienvenue',
      status: 'published',
    });
    await store.putTranslation({
      project: 'demo',
      namespace: 'common',
      locale: 'fr',
      key: 'home.hero.title',
      targetText: 'Bienvenue !',
      status: 'published',
    });

    const bundle = await store.getBundle('demo', 'fr', 'common');
    expect(bundle?.keys).toEqual({ 'home.hero.title': 'Bienvenue !' });
    expect(bundle?.version).toBe(1);

    await db.destroy();
  });

  test("throws when the project, namespace, locale, or key doesn't exist", async () => {
    const db = await createMigratedTestDb();
    await seedDemoProject(db);
    await db
      .insertInto('keys')
      .values({
        id: '88888888-8888-8888-8888-888888888888',
        namespace_id: '66666666-6666-6666-6666-666666666666',
        name: 'home.hero.title',
        source_text: 'Welcome',
        source_hash: 'deadbeef',
      })
      .execute();

    const store = new PostgresStore(db);

    await expect(
      store.putTranslation({
        project: 'demo',
        namespace: 'common',
        locale: 'fr',
        key: 'no.such.key',
        targetText: 'x',
        status: 'published',
      }),
    ).rejects.toThrow();

    await db.destroy();
  });
});

const KEY_ID = '88888888-8888-8888-8888-888888888888';

async function seedDemoKey(db: Awaited<ReturnType<typeof createMigratedTestDb>>) {
  await db
    .insertInto('keys')
    .values({
      id: KEY_ID,
      namespace_id: '66666666-6666-6666-6666-666666666666',
      name: 'home.hero.title',
      source_text: 'Welcome',
      source_hash: 'deadbeef',
    })
    .execute();
}

async function seedDemoTranslation(
  db: Awaited<ReturnType<typeof createMigratedTestDb>>,
  status: string,
) {
  await db
    .insertInto('translations')
    .values({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      key_id: KEY_ID,
      locale_id: '44444444-4444-4444-4444-444444444444',
      target_text: 'Bienvenue',
      status,
    })
    .execute();
}

const DEMO_REF = { project: 'demo', namespace: 'common', locale: 'fr', key: 'home.hero.title' };

describe('PostgresStore.saveTranslation', () => {
  test('saves straight to approved when the project has auto-approve on (the default)', async () => {
    const db = await createMigratedTestDb();
    await seedDemoProject(db);
    await seedDemoKey(db);

    const store = new PostgresStore(db);
    const status = await store.saveTranslation({ ...DEMO_REF, targetText: 'Bienvenue' });

    expect(status).toBe('approved');
    const row = await db
      .selectFrom('translations')
      .select(['status', 'target_text'])
      .where('key_id', '=', KEY_ID)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('approved');
    expect(row.target_text).toBe('Bienvenue');

    await db.destroy();
  });

  test('saves to needs_review when the project has auto-approve off', async () => {
    const db = await createMigratedTestDb();
    await seedDemoProject(db);
    await db
      .updateTable('projects')
      .set({ auto_approve: false })
      .where('id', '=', '33333333-3333-3333-3333-333333333333')
      .execute();
    await seedDemoKey(db);

    const store = new PostgresStore(db);
    const status = await store.saveTranslation({ ...DEMO_REF, targetText: 'Bienvenue' });

    expect(status).toBe('needs_review');

    await db.destroy();
  });

  test('editing an already-approved translation resets it back into review, not silently staying approved', async () => {
    const db = await createMigratedTestDb();
    await seedDemoProject(db);
    await db
      .updateTable('projects')
      .set({ auto_approve: false })
      .where('id', '=', '33333333-3333-3333-3333-333333333333')
      .execute();
    await seedDemoKey(db);
    await seedDemoTranslation(db, 'approved');

    const store = new PostgresStore(db);
    const status = await store.saveTranslation({ ...DEMO_REF, targetText: 'Bienvenue (updated)' });

    expect(status).toBe('needs_review');

    await db.destroy();
  });

  test("throws when the project, namespace, locale, or key doesn't exist", async () => {
    const db = await createMigratedTestDb();
    await seedDemoProject(db);
    await seedDemoKey(db);

    const store = new PostgresStore(db);

    await expect(
      store.saveTranslation({ ...DEMO_REF, key: 'no.such.key', targetText: 'x' }),
    ).rejects.toThrow();

    await db.destroy();
  });
});

describe('PostgresStore.saveTranslation save-time conflict detection (D22)', () => {
  test('succeeds when originalText matches the currently stored value (unchanged since load)', async () => {
    const db = await createMigratedTestDb();
    await seedDemoProject(db);
    await seedDemoKey(db);
    await seedDemoTranslation(db, 'approved');

    const store = new PostgresStore(db);
    const status = await store.saveTranslation({
      ...DEMO_REF,
      originalText: 'Bienvenue',
      targetText: 'Bienvenue !',
    });

    expect(status).toBe('approved');
    const row = await db
      .selectFrom('translations')
      .select('target_text')
      .where('key_id', '=', KEY_ID)
      .executeTakeFirstOrThrow();
    expect(row.target_text).toBe('Bienvenue !');

    await db.destroy();
  });

  test('succeeds when the stored value already matches the new text, even with a stale snapshot (no-op merge)', async () => {
    const db = await createMigratedTestDb();
    await seedDemoProject(db);
    await seedDemoKey(db);
    await seedDemoTranslation(db, 'approved');

    const store = new PostgresStore(db);
    const status = await store.saveTranslation({
      ...DEMO_REF,
      originalText: 'some stale snapshot the translator started from',
      targetText: 'Bienvenue',
    });

    expect(status).toBe('approved');

    await db.destroy();
  });

  test('rejects a save whose snapshot is stale and whose new text differs from what is stored, carrying the current stored value', async () => {
    const db = await createMigratedTestDb();
    await seedDemoProject(db);
    await seedDemoKey(db);
    await seedDemoTranslation(db, 'approved');

    const store = new PostgresStore(db);

    await expect(
      store.saveTranslation({
        ...DEMO_REF,
        originalText: 'some stale snapshot the translator started from',
        targetText: 'Bienvenue (my conflicting edit)',
      }),
    ).rejects.toThrow(SaveConflictError);

    try {
      await store.saveTranslation({
        ...DEMO_REF,
        originalText: 'some stale snapshot the translator started from',
        targetText: 'Bienvenue (my conflicting edit)',
      });
      throw new Error('expected saveTranslation to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(SaveConflictError);
      expect((err as SaveConflictError).currentText).toBe('Bienvenue');
    }

    const row = await db
      .selectFrom('translations')
      .select('target_text')
      .where('key_id', '=', KEY_ID)
      .executeTakeFirstOrThrow();
    expect(row.target_text).toBe('Bienvenue');

    await db.destroy();
  });

  test('skips the conflict check entirely when originalText is omitted', async () => {
    const db = await createMigratedTestDb();
    await seedDemoProject(db);
    await seedDemoKey(db);
    await seedDemoTranslation(db, 'approved');

    const store = new PostgresStore(db);
    const status = await store.saveTranslation({ ...DEMO_REF, targetText: 'Overwrite anyway' });

    expect(status).toBe('approved');

    await db.destroy();
  });
});

describe('PostgresStore.claimTranslationForReview', () => {
  test('claims an unclaimed needs_review translation', async () => {
    const db = await createMigratedTestDb();
    await seedDemoProject(db);
    await seedDemoKey(db);
    await seedDemoTranslation(db, 'needs_review');

    const store = new PostgresStore(db);
    const status = await store.claimTranslationForReview(DEMO_REF);

    expect(status).toBe('in_review');

    await db.destroy();
  });

  test('rejects claiming an already-approved translation', async () => {
    const db = await createMigratedTestDb();
    await seedDemoProject(db);
    await seedDemoKey(db);
    await seedDemoTranslation(db, 'approved');

    const store = new PostgresStore(db);

    await expect(store.claimTranslationForReview(DEMO_REF)).rejects.toThrow();

    await db.destroy();
  });
});

describe('PostgresStore.approveTranslation', () => {
  test('approves a claimed (in_review) translation', async () => {
    const db = await createMigratedTestDb();
    await seedDemoProject(db);
    await seedDemoKey(db);
    await seedDemoTranslation(db, 'in_review');

    const store = new PostgresStore(db);
    const status = await store.approveTranslation(DEMO_REF);

    expect(status).toBe('approved');

    await db.destroy();
  });

  test('rejects approving a translation that was never claimed', async () => {
    const db = await createMigratedTestDb();
    await seedDemoProject(db);
    await seedDemoKey(db);
    await seedDemoTranslation(db, 'needs_review');

    const store = new PostgresStore(db);

    await expect(store.approveTranslation(DEMO_REF)).rejects.toThrow();

    await db.destroy();
  });
});

describe('PostgresStore.sendTranslationBack', () => {
  test('sends a claimed translation back to needs_review with a comment', async () => {
    const db = await createMigratedTestDb();
    await seedDemoProject(db);
    await seedDemoKey(db);
    await seedDemoTranslation(db, 'in_review');

    const store = new PostgresStore(db);
    const status = await store.sendTranslationBack(DEMO_REF, 'Please fix the tone here.');

    expect(status).toBe('needs_review');

    await db.destroy();
  });

  test('rejects a send-back with an empty comment', async () => {
    const db = await createMigratedTestDb();
    await seedDemoProject(db);
    await seedDemoKey(db);
    await seedDemoTranslation(db, 'in_review');

    const store = new PostgresStore(db);

    await expect(store.sendTranslationBack(DEMO_REF, '')).rejects.toThrow();

    await db.destroy();
  });
});
