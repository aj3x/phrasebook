import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { type FetchImpl, fetchComments, postComment } from './api';

export interface CommentThreadProps {
  endpoint: string;
  project: string;
  namespace: string;
  locale: string;
  commentKey: string;
  fetchImpl?: FetchImpl;
}

/**
 * The thread of comments on one translation (§11). Read + append: fetches
 * the key/locale's thread and lets anyone with write access post to it.
 * Send-back comments authored server-side (step 11c) show up here too,
 * since they land in the same thread.
 */
export function CommentThread({
  endpoint,
  project,
  namespace,
  locale,
  commentKey,
  fetchImpl,
}: CommentThreadProps) {
  const queryClient = useQueryClient();
  const inputId = useId();
  const [draft, setDraft] = useState('');

  const queryKey = ['comments', endpoint, project, namespace, locale, commentKey];
  const { data, isPending, error } = useQuery({
    queryKey,
    queryFn: () => fetchComments(endpoint, project, namespace, locale, commentKey, fetchImpl),
  });

  const mutation = useMutation({
    mutationFn: (body: string) =>
      postComment(endpoint, project, namespace, locale, commentKey, body, fetchImpl),
    onSuccess: () => {
      setDraft('');
      queryClient.invalidateQueries({ queryKey });
    },
  });

  function submit() {
    if (draft.trim() === '') return;
    mutation.mutate(draft);
  }

  return (
    <div>
      {isPending && <p>Loading comments…</p>}
      {error && <p role="alert">Failed to load comments.</p>}
      {data && data.length === 0 && <p>No comments yet.</p>}
      {data && data.length > 0 && (
        <ul>
          {data.map((comment) => (
            <li key={comment.id}>
              <div>{comment.authorEmail ?? 'unknown'}</div>
              <div>{comment.body}</div>
            </li>
          ))}
        </ul>
      )}

      <div>
        <label htmlFor={inputId}>Add a comment</label>
        <textarea
          id={inputId}
          value={draft}
          disabled={mutation.isPending}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="button" disabled={mutation.isPending || draft.trim() === ''} onClick={submit}>
          Post
        </button>
        {mutation.isError && <p role="alert">Failed to post comment.</p>}
      </div>
    </div>
  );
}
