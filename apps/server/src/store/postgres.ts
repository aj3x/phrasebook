import type { Database } from '@phrasebook/db';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import {
  type TranslationStatus,
  approve,
  claimForReview,
  sendBack,
  statusAfterSave,
} from '../status';
import type {
  BundleResult,
  PutTranslationInput,
  SaveTranslationInput,
  Store,
  TranslationRef,
} from './store';

export class PostgresStore implements Store {
  constructor(private readonly db: Kysely<Database>) {}

  private async resolveRefIds(ref: TranslationRef) {
    const projectRow = await this.db
      .selectFrom('projects')
      .select(['id', 'auto_approve'])
      .where('name', '=', ref.project)
      .executeTakeFirstOrThrow(() => new Error(`Unknown project: ${ref.project}`));

    const [namespaceRow, localeRow] = await Promise.all([
      this.db
        .selectFrom('namespaces')
        .select('id')
        .where('project_id', '=', projectRow.id)
        .where('name', '=', ref.namespace)
        .executeTakeFirstOrThrow(() => new Error(`Unknown namespace: ${ref.namespace}`)),
      this.db
        .selectFrom('locales')
        .select('id')
        .where('project_id', '=', projectRow.id)
        .where('code', '=', ref.locale)
        .executeTakeFirstOrThrow(() => new Error(`Unknown locale: ${ref.locale}`)),
    ]);

    const keyRow = await this.db
      .selectFrom('keys')
      .select('id')
      .where('namespace_id', '=', namespaceRow.id)
      .where('name', '=', ref.key)
      .executeTakeFirstOrThrow(() => new Error(`Unknown key: ${ref.key}`));

    return {
      autoApprove: projectRow.auto_approve,
      namespaceId: namespaceRow.id,
      localeId: localeRow.id,
      keyId: keyRow.id,
    };
  }

  private async findTranslation(keyId: string, localeId: string) {
    return this.db
      .selectFrom('translations')
      .select(['id', 'status'])
      .where('key_id', '=', keyId)
      .where('locale_id', '=', localeId)
      .executeTakeFirstOrThrow(() => new Error('No translation exists for that key/locale yet'));
  }

  private async setStatus(translationId: string, status: TranslationStatus): Promise<void> {
    await this.db
      .updateTable('translations')
      .set({ status, updated_at: sql`now()` })
      .where('id', '=', translationId)
      .execute();
  }

  private async upsertTranslation(
    keyId: string,
    localeId: string,
    targetText: string,
    status: string,
  ): Promise<void> {
    await this.db
      .insertInto('translations')
      .values({
        id: crypto.randomUUID(),
        key_id: keyId,
        locale_id: localeId,
        target_text: targetText,
        status,
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
    const { keyId, localeId } = await this.resolveRefIds(input);
    await this.upsertTranslation(keyId, localeId, input.targetText, input.status);
  }

  async saveTranslation(input: SaveTranslationInput): Promise<TranslationStatus> {
    const { autoApprove, keyId, localeId } = await this.resolveRefIds(input);
    const status = statusAfterSave(autoApprove);
    await this.upsertTranslation(keyId, localeId, input.targetText, status);
    return status;
  }

  async claimTranslationForReview(ref: TranslationRef): Promise<TranslationStatus> {
    const { keyId, localeId } = await this.resolveRefIds(ref);
    const translation = await this.findTranslation(keyId, localeId);
    const status = claimForReview(translation.status as TranslationStatus);
    await this.setStatus(translation.id, status);
    return status;
  }

  async approveTranslation(ref: TranslationRef): Promise<TranslationStatus> {
    const { keyId, localeId } = await this.resolveRefIds(ref);
    const translation = await this.findTranslation(keyId, localeId);
    const status = approve(translation.status as TranslationStatus);
    await this.setStatus(translation.id, status);
    return status;
  }

  async sendTranslationBack(ref: TranslationRef, comment: string): Promise<TranslationStatus> {
    const { keyId, localeId } = await this.resolveRefIds(ref);
    const translation = await this.findTranslation(keyId, localeId);
    const status = sendBack(translation.status as TranslationStatus, comment);
    await this.setStatus(translation.id, status);
    return status;
  }
}
