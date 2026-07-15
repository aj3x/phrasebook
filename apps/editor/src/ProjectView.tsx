import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { CommentThread } from './CommentThread';
import { KeyTable } from './KeyTable';
import {
  type FetchImpl,
  type ProjectDetail,
  approveTranslation,
  claimTranslation,
  fetchKeys,
  fetchProjectDetail,
  saveTranslation,
  sendBackTranslation,
  setAutoApprove,
} from './api';

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
  const autoApproveId = useId();
  const queryClient = useQueryClient();
  const detailQueryKey = ['project-detail', endpoint, project];

  const [namespace, setNamespace] = useState<string | undefined>(undefined);
  const [locale, setLocale] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState('');

  const detailQuery = useQuery({
    queryKey: detailQueryKey,
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

  async function handleClaim(key: string) {
    const outcome = await claimTranslation(
      endpoint,
      project,
      effectiveNamespace as string,
      effectiveLocale as string,
      key,
      fetchImpl,
    );
    if (outcome.kind === 'success') {
      queryClient.invalidateQueries({ queryKey: keysQueryKey });
    }
    return outcome;
  }

  async function handleApprove(key: string) {
    const outcome = await approveTranslation(
      endpoint,
      project,
      effectiveNamespace as string,
      effectiveLocale as string,
      key,
      fetchImpl,
    );
    if (outcome.kind === 'success') {
      queryClient.invalidateQueries({ queryKey: keysQueryKey });
    }
    return outcome;
  }

  async function handleSendBack(key: string, comment: string) {
    const outcome = await sendBackTranslation(
      endpoint,
      project,
      effectiveNamespace as string,
      effectiveLocale as string,
      key,
      comment,
      fetchImpl,
    );
    if (outcome.kind === 'success') {
      queryClient.invalidateQueries({ queryKey: keysQueryKey });
    }
    return outcome;
  }

  // Optimistic so the checkbox reflects the click immediately; reverts if
  // the server rejects it (e.g. lost the project-manager role mid-session).
  async function handleToggleAutoApprove(next: boolean) {
    queryClient.setQueryData<ProjectDetail>(detailQueryKey, (old) =>
      old ? { ...old, autoApprove: next } : old,
    );
    try {
      await setAutoApprove(endpoint, project, next, fetchImpl);
    } catch {
      queryClient.setQueryData<ProjectDetail>(detailQueryKey, (old) =>
        old ? { ...old, autoApprove: !next } : old,
      );
    }
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
          <label htmlFor={autoApproveId}>
            <input
              id={autoApproveId}
              type="checkbox"
              checked={detail.autoApprove}
              onChange={(e) => handleToggleAutoApprove(e.target.checked)}
            />
            Auto-approve translator saves
          </label>

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
              locale={effectiveLocale as string}
              onSave={handleSave}
              onClaim={handleClaim}
              onApprove={handleApprove}
              onSendBack={handleSendBack}
              renderComments={(key) => (
                <CommentThread
                  endpoint={endpoint}
                  project={project}
                  namespace={effectiveNamespace as string}
                  locale={effectiveLocale as string}
                  commentKey={key}
                  fetchImpl={fetchImpl}
                />
              )}
            />
          )}
        </>
      )}
    </main>
  );
}
