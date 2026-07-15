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
  /**
   * The translator's snapshot of `target_text` when they started editing
   * (D22) -- omit it to skip the conflict check entirely (e.g. seed/demo
   * writes that don't come from a live editing session). When provided
   * and it no longer matches the currently stored value, and the new
   * text doesn't already match what's stored, the save is rejected with
   * a SaveConflictError rather than silently overwriting a concurrent
   * edit.
   */
  originalText?: string;
  /**
   * The signed-in user producing this save, recorded on the row as
   * `last_editor_id` so approveTranslation can enforce H3 separation
   * of duties (a reviewer can't approve their own edit). Omitted for
   * seed/demo writes -- those rows stay grandfathered (null editor,
   * always approvable).
   */
  editorUserId?: string;
}

export interface AccessibleProject {
  name: string;
  sourceLocale: string;
}

export interface ProjectDetail {
  name: string;
  sourceLocale: string;
  locales: string[];
  namespaces: string[];
  autoApprove: boolean;
}

export interface ListKeysRef {
  project: string;
  namespace: string;
  locale: string;
}

export interface ListKeysFilter {
  status?: string;
}

/**
 * A thread entry (§4, §11). `authorEmail` is null once the author's user
 * row has been deleted (the comment survives, ON DELETE SET NULL).
 * `createdAt` is an ISO-8601 string for a stable cross-boundary shape.
 */
export interface Comment {
  id: string;
  body: string;
  authorEmail: string | null;
  createdAt: string;
}

export interface AddCommentInput extends TranslationRef {
  authorId: string;
  body: string;
}

export interface KeyRow {
  key: string;
  sourceText: string;
  targetText: string;
  status: TranslationStatus;
}

/**
 * What projects a caller can see: `allProjects` is true when at least one
 * of the user's role assignments is instance-wide (§F3 -- a NULL
 * project_id grant), in which case `projectIds` is ignored; otherwise
 * only the projects in `projectIds` (the union of the user's
 * project-scoped grants) are returned. Computed by the caller from
 * AuthContext.roles -- kept out of this file so Store doesn't depend on
 * the session middleware's types.
 */
export interface ProjectAccessScope {
  allProjects: boolean;
  projectIds: string[];
}

/**
 * A save-time conflict per D22: not a hard lock (§F6 -- "rely on the DB
 * status for now, not a hard lock"), just a check at the moment of save.
 * Carries the currently stored text so a client can show a diff and let
 * the user submit-over or cancel, rather than a bare rejection.
 */
export class SaveConflictError extends Error {
  constructor(public readonly currentText: string) {
    super('The translation has changed since you started editing');
    this.name = 'SaveConflictError';
  }
}

/**
 * §5 separation-of-duties (H3): under manual review (auto_approve=off),
 * the user approving a translation must be different from the user whose
 * save produced the current text. Distinct from InvalidTransitionError
 * so the app can map it to 403 (policy) rather than 409 (state).
 */
export class SelfApprovalError extends Error {
  constructor() {
    super('You cannot approve a translation you edited yourself');
    this.name = 'SelfApprovalError';
  }
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
  /**
   * `approverUserId` is compared against the translation's
   * `last_editor_id` to enforce H3 SoD. Pass the authenticated user's
   * id; omit only for internal call sites that legitimately bypass the
   * check (none in M2).
   */
  approveTranslation(ref: TranslationRef, approverUserId?: string): Promise<TranslationStatus>;
  /**
   * Persists `comment` as a locale-scoped thread entry (§11) authored by
   * `reviewerUserId` alongside the status change; the comment is already
   * validated non-empty by the status machine before any write. Omit the
   * reviewer id only for internal callers with no user identity.
   */
  sendTranslationBack(
    ref: TranslationRef,
    comment: string,
    reviewerUserId?: string,
  ): Promise<TranslationStatus>;
  addComment(input: AddCommentInput): Promise<Comment>;
  listComments(ref: TranslationRef): Promise<Comment[]>;
  listAccessibleProjects(scope: ProjectAccessScope): Promise<AccessibleProject[]>;
  findProjectId(project: string): Promise<string | undefined>;
  getProjectDetail(project: string): Promise<ProjectDetail | undefined>;
  setProjectAutoApprove(project: string, autoApprove: boolean): Promise<boolean>;
  listKeys(ref: ListKeysRef, filter?: ListKeysFilter): Promise<KeyRow[]>;
}
