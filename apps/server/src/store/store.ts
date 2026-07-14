import type { TranslationStatus } from '../status';

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

export interface TranslationRef {
  project: string;
  namespace: string;
  locale: string;
  key: string;
}

export interface SaveTranslationInput extends TranslationRef {
  targetText: string;
}

/**
 * The minimal M1 subset of the full §6 store interface (tms-foundations.md).
 * Read-heavy for now: getBundle serves the runtime endpoint (step 6);
 * putTranslation exists only so the seed script (step 7) has a real write
 * path instead of reaching into Kysely directly. No write-ack levels, no
 * capability flags, no git driver yet — those arrive when a second driver
 * (lite mode) actually needs them.
 *
 * saveTranslation/claimTranslationForReview/approveTranslation/
 * sendTranslationBack (M2 step 4) are the actual editor write path: unlike
 * putTranslation, they never take a caller-supplied status -- the status
 * machine (../status.ts) decides it from the project's auto_approve
 * setting and the translation's current status, so callers can't
 * accidentally bypass §5's transition rules.
 */
export interface Store {
  getBundle(project: string, locale: string, namespace: string): Promise<BundleResult | undefined>;
  putTranslation(input: PutTranslationInput): Promise<void>;
  saveTranslation(input: SaveTranslationInput): Promise<TranslationStatus>;
  claimTranslationForReview(ref: TranslationRef): Promise<TranslationStatus>;
  approveTranslation(ref: TranslationRef): Promise<TranslationStatus>;
  sendTranslationBack(ref: TranslationRef, comment: string): Promise<TranslationStatus>;
}
