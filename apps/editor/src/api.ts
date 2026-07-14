export interface AccessibleProject {
  name: string;
  sourceLocale: string;
}

export interface ProjectDetail {
  name: string;
  sourceLocale: string;
  locales: string[];
  namespaces: string[];
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
  const path = [
    'v1',
    'projects',
    encodeURIComponent(project),
    'translations',
    encodeURIComponent(namespace),
    encodeURIComponent(locale),
    encodeURIComponent(key),
  ].join('/');

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
