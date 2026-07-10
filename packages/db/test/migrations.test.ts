import { describe, expect, test } from 'bun:test';
import type { NamespaceAuthority } from '../src/generated';
import { createMigratedTestDb } from './helpers/test-db';

describe('migrations', () => {
  test('creates organizations and workspaces with a working foreign key', async () => {
    const db = await createMigratedTestDb();

    const org = await db
      .insertInto('organizations')
      .values({ id: '11111111-1111-1111-1111-111111111111', name: 'Acme' })
      .returningAll()
      .executeTakeFirstOrThrow();

    expect(org.name).toBe('Acme');

    const workspace = await db
      .insertInto('workspaces')
      .values({
        id: '22222222-2222-2222-2222-222222222222',
        org_id: org.id,
        name: 'Acme Marketing',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    expect(workspace.org_id).toBe(org.id);

    await expect(
      db
        .insertInto('workspaces')
        .values({
          id: '33333333-3333-3333-3333-333333333333',
          org_id: '00000000-0000-0000-0000-000000000000',
          name: 'Orphan',
        })
        .execute(),
    ).rejects.toThrow();

    await db.destroy();
  });

  test('creates projects and locales with a per-project unique locale code', async () => {
    const db = await createMigratedTestDb();

    await db
      .insertInto('organizations')
      .values({ id: '11111111-1111-1111-1111-111111111111', name: 'Acme' })
      .execute();

    const workspace = await db
      .insertInto('workspaces')
      .values({
        id: '22222222-2222-2222-2222-222222222222',
        org_id: '11111111-1111-1111-1111-111111111111',
        name: 'Acme Marketing',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const project = await db
      .insertInto('projects')
      .values({
        id: '33333333-3333-3333-3333-333333333333',
        workspace_id: workspace.id,
        name: 'Demo',
        source_locale: 'en',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    expect(project.source_locale).toBe('en');

    const locale = await db
      .insertInto('locales')
      .values({
        id: '44444444-4444-4444-4444-444444444444',
        project_id: project.id,
        code: 'fr-CA',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    expect(locale.code).toBe('fr-CA');

    await expect(
      db
        .insertInto('locales')
        .values({
          id: '55555555-5555-5555-5555-555555555555',
          project_id: project.id,
          code: 'fr-CA',
        })
        .execute(),
    ).rejects.toThrow();

    await db.destroy();
  });

  test('creates namespaces (authority-checked) and keys (unique per namespace)', async () => {
    const db = await createMigratedTestDb();

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
    const project = await db
      .insertInto('projects')
      .values({
        id: '33333333-3333-3333-3333-333333333333',
        workspace_id: '22222222-2222-2222-2222-222222222222',
        name: 'Demo',
        source_locale: 'en',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const namespace = await db
      .insertInto('namespaces')
      .values({
        id: '66666666-6666-6666-6666-666666666666',
        project_id: project.id,
        name: 'common',
        authority: 'code',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    expect(namespace.authority).toBe('code');

    await expect(
      db
        .insertInto('namespaces')
        .values({
          id: '77777777-7777-7777-7777-777777777777',
          project_id: project.id,
          name: 'bogus-authority',
          // Intentionally invalid: proves the DB-level CHECK constraint
          // rejects it, independent of the TS union type.
          authority: 'not-a-real-authority' as unknown as NamespaceAuthority,
        })
        .execute(),
    ).rejects.toThrow();

    const key = await db
      .insertInto('keys')
      .values({
        id: '88888888-8888-8888-8888-888888888888',
        namespace_id: namespace.id,
        name: 'home.hero.title',
        source_text: 'Welcome',
        source_hash: 'deadbeef',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    expect(key.source_text).toBe('Welcome');

    await expect(
      db
        .insertInto('keys')
        .values({
          id: '99999999-9999-9999-9999-999999999999',
          namespace_id: namespace.id,
          name: 'home.hero.title',
          source_text: 'Welcome again',
          source_hash: 'cafebabe',
        })
        .execute(),
    ).rejects.toThrow();

    await db.destroy();
  });

  test('creates translations, unique per (key, locale), with a default version', async () => {
    const db = await createMigratedTestDb();

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
        name: 'Demo',
        source_locale: 'en',
      })
      .execute();
    const locale = await db
      .insertInto('locales')
      .values({
        id: '44444444-4444-4444-4444-444444444444',
        project_id: '33333333-3333-3333-3333-333333333333',
        code: 'fr',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await db
      .insertInto('namespaces')
      .values({
        id: '66666666-6666-6666-6666-666666666666',
        project_id: '33333333-3333-3333-3333-333333333333',
        name: 'common',
        authority: 'code',
      })
      .execute();
    const key = await db
      .insertInto('keys')
      .values({
        id: '88888888-8888-8888-8888-888888888888',
        namespace_id: '66666666-6666-6666-6666-666666666666',
        name: 'home.hero.title',
        source_text: 'Welcome',
        source_hash: 'deadbeef',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const translation = await db
      .insertInto('translations')
      .values({
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        key_id: key.id,
        locale_id: locale.id,
        target_text: 'Bienvenue',
        status: 'published',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    expect(translation.target_text).toBe('Bienvenue');
    expect(translation.version).toBe(0);
    expect(translation.updated_at).toBeTruthy();

    await expect(
      db
        .insertInto('translations')
        .values({
          id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          key_id: key.id,
          locale_id: locale.id,
          target_text: 'Bienvenue encore',
          status: 'published',
        })
        .execute(),
    ).rejects.toThrow();

    await db.destroy();
  });
});
