/**
 * Role-name constants shared across route modules. M3 (see
 * plan/03-milestone-3-onboarding.md) replaces every one of these with a
 * `resource:action` permission check and deletes this file -- kept
 * centralized here rather than scattered per-route so that migration is a
 * one-file edit instead of a hunt across `routes/*`.
 */
export const CAN_SAVE_TRANSLATIONS = ['Admin', 'Developer', 'Translator', 'Reviewer'];
export const CAN_REVIEW_TRANSLATIONS = ['Admin', 'Developer', 'Reviewer'];
// Project configuration (e.g. the auto-approve review policy) is an admin/
// dev concern -- translators and reviewers work within the policy, they
// don't set it.
export const CAN_MANAGE_PROJECT = ['Admin', 'Developer'];
export const ANY_ROLE = ['Admin', 'Developer', 'Translator', 'Reviewer', 'Viewer'];
