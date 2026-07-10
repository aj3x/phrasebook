export interface BundleResult {
  keys: Record<string, string>;
  version: number;
  etag: string;
}

export interface PutTranslationInput {
  project: string;
  namespace: string;
  locale: string;
  key: string;
  targetText: string;
  status: string;
}

/**
 * The minimal M1 subset of the full §6 store interface (tms-foundations.md).
 * Read-heavy for now: getBundle serves the runtime endpoint (step 6);
 * putTranslation exists only so the seed script (step 7) has a real write
 * path instead of reaching into Kysely directly. No write-ack levels, no
 * capability flags, no git driver yet — those arrive when a second driver
 * (lite mode) actually needs them.
 */
export interface Store {
  getBundle(project: string, locale: string, namespace: string): Promise<BundleResult | undefined>;
  putTranslation(input: PutTranslationInput): Promise<void>;
}
