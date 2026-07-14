/**
 * The status machine spine for §5 of tms-foundations.md: one source of
 * truth for all 8 states and the transitions between them, rather than
 * scattering the rules across route handlers.
 */
export type TranslationStatus =
  | 'untranslated'
  | 'machine_translated'
  | 'needs_review'
  | 'in_review'
  | 'approved'
  | 'published'
  | 'needs_update'
  | 'deprecated';

export class InvalidTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTransitionError';
  }
}

/**
 * A human save always lands on `approved` or `needs_review` depending on
 * the project's auto-approve setting, regardless of the translation's
 * current status -- this is also what makes editing an already-approved
 * translation reset it back into the review flow instead of silently
 * staying `approved` with stale content (§5).
 */
export function statusAfterSave(autoApprove: boolean): TranslationStatus {
  return autoApprove ? 'approved' : 'needs_review';
}

export function claimForReview(current: TranslationStatus): TranslationStatus {
  if (current !== 'needs_review' && current !== 'machine_translated') {
    throw new InvalidTransitionError(
      `Cannot claim a translation in status "${current}" for review`,
    );
  }
  return 'in_review';
}

export function approve(current: TranslationStatus): TranslationStatus {
  if (current !== 'in_review') {
    throw new InvalidTransitionError(`Cannot approve a translation in status "${current}"`);
  }
  return 'approved';
}

/** Send-back requires a comment (§5) -- rejection must never be conflated with needs_update. */
export function sendBack(current: TranslationStatus, comment: string): TranslationStatus {
  if (current !== 'in_review') {
    throw new InvalidTransitionError(`Cannot send back a translation in status "${current}"`);
  }
  if (comment.trim().length === 0) {
    throw new InvalidTransitionError('Send-back requires a non-empty comment');
  }
  return 'needs_review';
}

export function markNeedsUpdate(current: TranslationStatus): TranslationStatus {
  if (current !== 'approved' && current !== 'published') {
    throw new InvalidTransitionError(
      `Cannot mark a translation in status "${current}" as needing an update`,
    );
  }
  return 'needs_update';
}

export function deprecate(current: TranslationStatus): TranslationStatus {
  if (current === 'deprecated') {
    throw new InvalidTransitionError('Translation is already deprecated');
  }
  return 'deprecated';
}

/** Deprecation is reversible (§5) -- restores to whatever status preceded it. */
export function restore(priorStatus: TranslationStatus): TranslationStatus {
  if (priorStatus === 'deprecated') {
    throw new InvalidTransitionError('Cannot restore to the deprecated status itself');
  }
  return priorStatus;
}
