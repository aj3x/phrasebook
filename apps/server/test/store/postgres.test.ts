import { describe, expect, test } from 'bun:test';
import { createMigratedTestDb } from '@phrasebook/db/test-utils';
import { PostgresStore } from '../../src/store/postgres';

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
