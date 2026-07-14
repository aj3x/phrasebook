import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { KeyTable } from './KeyTable';
import { type FetchImpl, fetchKeys, fetchProjectDetail, saveTranslation } from './api';

const STATUS_FILTER_OPTIONS = [
  'untranslated',
  'machine_translated',
  'needs_review',
  'in_review',
  'approved',
  'published',
  'needs_update',
  'deprecated',
];

export interface ProjectViewProps {
  endpoint: string;
  project: string;
  onBack: () => void;
  fetchImpl?: FetchImpl;
}

export function ProjectView({ endpoint, project, onBack, fetchImpl }: ProjectViewProps) {
  const namespaceId = useId();
  const localeId = useId();
  const statusId = useId();
  const queryClient = useQueryClient();

  const [namespace, setNamespace] = useState<string | undefined>(undefined);
  const [locale, setLocale] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState('');

  const detailQuery = useQuery({
    queryKey: ['project-detail', endpoint, project],
    queryFn: () => fetchProjectDetail(endpoint, project, fetchImpl),
  });
  const detail = detailQuery.data;

  const effectiveNamespace = namespace ?? detail?.namespaces[0];
  const effectiveLocale = locale ?? detail?.locales[0];

  const keysQueryKey = ['keys', endpoint, project, effectiveNamespace, effectiveLocale, status];
  const keysQuery = useQuery({
    queryKey: keysQueryKey,
    queryFn: () =>
      fetchKeys(
        endpoint,
        project,
        effectiveNamespace as string,
        effectiveLocale as string,
        status ? { status } : {},
        fetchImpl,
      ),
    enabled: Boolean(effectiveNamespace && effectiveLocale),
  });

  async function handleSave(key: string, originalText: string, targetText: string) {
    const outcome = await saveTranslation(
      endpoint,
      project,
      effectiveNamespace as string,
      effectiveLocale as string,
      key,
      targetText,
      originalText,
      fetchImpl,
    );
    if (outcome.kind === 'success') {
      // KeyTable already shows the reconciled text/status optimistically;
      // this just brings the underlying query back in sync eventually
      // (e.g. another user's concurrent edits on other keys).
      queryClient.invalidateQueries({ queryKey: keysQueryKey });
    }
    return outcome;
  }

  return (
    <main>
      <button type="button" onClick={onBack}>
        ← Projects
      </button>
      <h1>{project}</h1>

      {detailQuery.isPending && <p>Loading project…</p>}
      {detailQuery.error && <p role="alert">Failed to load project.</p>}

      {detail && (
        <>
          <label htmlFor={namespaceId}>
            Namespace
            <select
              id={namespaceId}
              value={effectiveNamespace}
              onChange={(e) => setNamespace(e.target.value)}
            >
              {detail.namespaces.map((ns) => (
                <option key={ns} value={ns}>
                  {ns}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor={localeId}>
            Locale
            <select
              id={localeId}
              value={effectiveLocale}
              onChange={(e) => setLocale(e.target.value)}
            >
              {detail.locales.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor={statusId}>
            Status
            <select id={statusId} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {STATUS_FILTER_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>

          {keysQuery.isPending && <p>Loading keys…</p>}
          {keysQuery.error && <p role="alert">Failed to load keys.</p>}
          {keysQuery.data && (
            <KeyTable
              key={`${effectiveNamespace}-${effectiveLocale}-${status}`}
              rows={keysQuery.data}
              onSave={handleSave}
            />
          )}
        </>
      )}
    </main>
  );
}
