export interface AccessibleProject {
  name: string;
  sourceLocale: string;
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
