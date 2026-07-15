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

export interface KeyRow {
  key: string;
  sourceText: string;
  targetText: string;
  status: string;
}

export type FetchImpl = typeof fetch;

/**
 * Cookie-based session auth (D-session-model from M2's open questions) --
 * credentials: 'include' is required for the server to see the session
 * cookie on a cross-origin (5174 -> 3000) request.
 */
export async function fetchAccessibleProjects(
  endpoint: string,
  fetchImpl: FetchImpl = fetch,
): Promise<AccessibleProject[]> {
  const res = await fetchImpl(`${endpoint}/v1/projects`, { credentials: 'include' });
  if (!res.ok) {
    throw new Error(`Failed to load projects (${res.status})`);
  }
  const body = (await res.json()) as { projects: AccessibleProject[] };
  return body.projects;
}

export async function fetchProjectDetail(
  endpoint: string,
  project: string,
  fetchImpl: FetchImpl = fetch,
): Promise<ProjectDetail> {
  const res = await fetchImpl(`${endpoint}/v1/projects/${encodeURIComponent(project)}`, {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`Failed to load project (${res.status})`);
  }
  return (await res.json()) as ProjectDetail;
}

export interface FetchKeysOptions {
  status?: string;
}

export async function fetchKeys(
  endpoint: string,
  project: string,
  namespace: string,
  locale: string,
  options: FetchKeysOptions = {},
  fetchImpl: FetchImpl = fetch,
): Promise<KeyRow[]> {
  const params = new URLSearchParams({ namespace, locale });
  if (options.status) {
    params.set('status', options.status);
  }
  const res = await fetchImpl(
    `${endpoint}/v1/projects/${encodeURIComponent(project)}/keys?${params.toString()}`,
    { credentials: 'include' },
  );
  if (!res.ok) {
    throw new Error(`Failed to load keys (${res.status})`);
  }
  const body = (await res.json()) as { keys: KeyRow[] };
  return body.keys;
}

function translationPath(project: string, namespace: string, locale: string, key: string): string {
  return [
    'v1',
    'projects',
    encodeURIComponent(project),
    'translations',
    encodeURIComponent(namespace),
    encodeURIComponent(locale),
    encodeURIComponent(key),
  ].join('/');
}

export type SaveOutcome =
  | { kind: 'success'; status: string }
  | { kind: 'conflict'; currentText: string }
  | { kind: 'error'; message: string };

/**
 * Never throws -- a save-time conflict (D22, §5) is an expected, routine
 * outcome the caller needs to react to (show the stored value next to the
 * draft), not an exceptional one. Only truly unexpected failures collapse
 * into the generic 'error' branch.
 */
export async function saveTranslation(
  endpoint: string,
  project: string,
  namespace: string,
  locale: string,
  key: string,
  targetText: string,
  originalText: string,
  fetchImpl: FetchImpl = fetch,
): Promise<SaveOutcome> {
  const path = translationPath(project, namespace, locale, key);

  const res = await fetchImpl(`${endpoint}/${path}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetText, originalText }),
  });
  const body = await res.json().catch(() => ({}));

  if (res.ok) {
    return { kind: 'success', status: body.status };
  }
  if (res.status === 409) {
    return { kind: 'conflict', currentText: body.currentText };
  }
  return { kind: 'error', message: body.error ?? `Save failed (${res.status})` };
}

/**
 * Result of a review action (claim / approve / send-back). Never throws --
 * a self-approval rejection (H3 SoD, 403) or an invalid transition (409)
 * is a routine outcome to show the reviewer, not an exception. The server
 * owns the human-readable message (e.g. "You cannot approve a translation
 * you edited yourself"), so we just surface it.
 */
export type ReviewOutcome =
  | { kind: 'success'; status: string }
  | { kind: 'error'; message: string };

async function postReviewAction(
  endpoint: string,
  path: string,
  action: string,
  body: unknown,
  fetchImpl: FetchImpl,
): Promise<ReviewOutcome> {
  const res = await fetchImpl(`${endpoint}/${path}/${action}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const payload = await res.json().catch(() => ({}));

  if (res.ok) {
    return { kind: 'success', status: payload.status };
  }
  return { kind: 'error', message: payload.error ?? `Request failed (${res.status})` };
}

export function claimTranslation(
  endpoint: string,
  project: string,
  namespace: string,
  locale: string,
  key: string,
  fetchImpl: FetchImpl = fetch,
): Promise<ReviewOutcome> {
  return postReviewAction(
    endpoint,
    translationPath(project, namespace, locale, key),
    'claim',
    {},
    fetchImpl,
  );
}

export function approveTranslation(
  endpoint: string,
  project: string,
  namespace: string,
  locale: string,
  key: string,
  fetchImpl: FetchImpl = fetch,
): Promise<ReviewOutcome> {
  return postReviewAction(
    endpoint,
    translationPath(project, namespace, locale, key),
    'approve',
    {},
    fetchImpl,
  );
}

export function sendBackTranslation(
  endpoint: string,
  project: string,
  namespace: string,
  locale: string,
  key: string,
  comment: string,
  fetchImpl: FetchImpl = fetch,
): Promise<ReviewOutcome> {
  return postReviewAction(
    endpoint,
    translationPath(project, namespace, locale, key),
    'send-back',
    { comment },
    fetchImpl,
  );
}

export async function setAutoApprove(
  endpoint: string,
  project: string,
  autoApprove: boolean,
  fetchImpl: FetchImpl = fetch,
): Promise<boolean> {
  const res = await fetchImpl(`${endpoint}/v1/projects/${encodeURIComponent(project)}/settings`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autoApprove }),
  });
  if (!res.ok) {
    throw new Error(`Failed to update project settings (${res.status})`);
  }
  const body = (await res.json()) as { autoApprove: boolean };
  return body.autoApprove;
}

export interface Comment {
  id: string;
  body: string;
  authorEmail: string | null;
  createdAt: string;
}

function commentPath(project: string, namespace: string, locale: string, key: string): string {
  return [
    'v1',
    'projects',
    encodeURIComponent(project),
    'comments',
    encodeURIComponent(namespace),
    encodeURIComponent(locale),
    encodeURIComponent(key),
  ].join('/');
}

export async function fetchComments(
  endpoint: string,
  project: string,
  namespace: string,
  locale: string,
  key: string,
  fetchImpl: FetchImpl = fetch,
): Promise<Comment[]> {
  const res = await fetchImpl(`${endpoint}/${commentPath(project, namespace, locale, key)}`, {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`Failed to load comments (${res.status})`);
  }
  const body = (await res.json()) as { comments: Comment[] };
  return body.comments;
}

export async function postComment(
  endpoint: string,
  project: string,
  namespace: string,
  locale: string,
  key: string,
  body: string,
  fetchImpl: FetchImpl = fetch,
): Promise<Comment> {
  const res = await fetchImpl(`${endpoint}/${commentPath(project, namespace, locale, key)}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    throw new Error(`Failed to post comment (${res.status})`);
  }
  const payload = (await res.json()) as { comment: Comment };
  return payload.comment;
}
