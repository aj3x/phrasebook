import type { Database } from '@phrasebook/db';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { BundleResult, PutTranslationInput, Store } from './store';

export class PostgresStore implements Store {
  constructor(private readonly db: Kysely<Database>) {}

  async getBundle(
    project: string,
    locale: string,
    namespace: string,
  ): Promise<BundleResult | undefined> {
    const projectRow = await this.db
      .selectFrom('projects')
      .select('id')
      .where('name', '=', project)
      .executeTakeFirst();
    if (!projectRow) return undefined;

    const [namespaceRow, localeRow] = await Promise.all([
      this.db
        .selectFrom('namespaces')
        .select('id')
        .where('project_id', '=', projectRow.id)
        .where('name', '=', namespace)
        .executeTakeFirst(),
      this.db
        .selectFrom('locales')
        .select('id')
        .where('project_id', '=', projectRow.id)
        .where('code', '=', locale)
        .executeTakeFirst(),
    ]);
    if (!namespaceRow || !localeRow) return undefined;

    const rows = await this.db
      .selectFrom('keys')
      .innerJoin('translations', 'translations.key_id', 'keys.id')
      .select([
        'keys.name as keyName',
        'translations.target_text as targetText',
        'translations.version as version',
      ])
      .where('keys.namespace_id', '=', namespaceRow.id)
      .where('translations.locale_id', '=', localeRow.id)
      .execute();

    const keys: Record<string, string> = {};
    let version = 0;
    for (const row of rows) {
      keys[row.keyName] = row.targetText;
      version = Math.max(version, row.version);
    }

    return { keys, version, etag: `"${version}"` };
  }

  async putTranslation(input: PutTranslationInput): Promise<void> {
    const projectRow = await this.db
      .selectFrom('projects')
      .select('id')
      .where('name', '=', input.project)
      .executeTakeFirstOrThrow(() => new Error(`Unknown project: ${input.project}`));

    const [namespaceRow, localeRow] = await Promise.all([
      this.db
        .selectFrom('namespaces')
        .select('id')
        .where('project_id', '=', projectRow.id)
        .where('name', '=', input.namespace)
        .executeTakeFirstOrThrow(() => new Error(`Unknown namespace: ${input.namespace}`)),
      this.db
        .selectFrom('locales')
        .select('id')
        .where('project_id', '=', projectRow.id)
        .where('code', '=', input.locale)
        .executeTakeFirstOrThrow(() => new Error(`Unknown locale: ${input.locale}`)),
    ]);

    const keyRow = await this.db
      .selectFrom('keys')
      .select('id')
      .where('namespace_id', '=', namespaceRow.id)
      .where('name', '=', input.key)
      .executeTakeFirstOrThrow(() => new Error(`Unknown key: ${input.key}`));

    await this.db
      .insertInto('translations')
      .values({
        id: crypto.randomUUID(),
        key_id: keyRow.id,
        locale_id: localeRow.id,
        target_text: input.targetText,
        status: input.status,
      })
      .onConflict((oc) =>
        oc.columns(['key_id', 'locale_id']).doUpdateSet((eb) => ({
          target_text: eb.ref('excluded.target_text'),
          status: eb.ref('excluded.status'),
          version: sql`translations.version + 1`,
          updated_at: sql`now()`,
        })),
      )
      .execute();
  }
}
