import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import type { KeyRow, ReviewOutcome, SaveOutcome } from './api';
import { type PluralEditState, computePluralEditState, reassemblePluralEdit } from './icuEditing';

const TARGET_COLUMN_INDEX = 2;

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

const STATUS_STYLES: Record<string, React.CSSProperties> = {
  // machine_translated is untouched-by-a-human MT output -- visually
  // distinct everywhere per §5, even though M2 has no MT producer yet.
  machine_translated: { fontStyle: 'italic', color: '#8a6d00', background: '#fff6db' },
  untranslated: { color: '#888888' },
  needs_review: { color: '#a15c00' },
  in_review: { color: '#0060a1' },
  approved: { color: '#0a7a2f' },
  published: { color: '#0a7a2f', fontWeight: 700 },
  needs_update: { color: '#b00020' },
  deprecated: { color: '#888888', textDecoration: 'line-through' },
  // Client-side-only transitional label, not a real §5 status -- shown
  // optimistically between committing an edit and the save resolving.
  saving: { fontStyle: 'italic', color: '#888888' },
};

function StatusBadge({ status }: { status: string }) {
  const label = status === 'saving' ? 'saving…' : status.replace(/_/g, ' ');
  return <span style={STATUS_STYLES[status] ?? {}}>{label}</span>;
}

const columnHelper = createColumnHelper<KeyRow>();

const columns = [
  columnHelper.accessor('key', { header: 'Key' }),
  columnHelper.accessor('sourceText', { header: 'Source' }),
  columnHelper.accessor('targetText', { header: 'Target' }),
  columnHelper.accessor('status', {
    header: 'Status',
    cell: (info) => <StatusBadge status={info.getValue()} />,
  }),
];

type EditStatus = 'editing' | 'saving' | 'conflict';

interface BaseEditingState {
  rowIndex: number;
  key: string;
  originalText: string;
  status: EditStatus;
  currentText?: string;
  errorMessage?: string;
}

interface PlainEditingState extends BaseEditingState {
  kind: 'plain';
  draft: string;
}

interface PluralEditingState extends BaseEditingState {
  kind: 'plural';
  meta: PluralEditState;
  draft: Record<string, string>;
}

type EditingState = PlainEditingState | PluralEditingState;

function computeNewText(state: EditingState): string {
  if (state.kind === 'plural') {
    return reassemblePluralEdit(state.meta, state.draft);
  }
  return state.draft;
}

export interface KeyTableProps {
  rows: KeyRow[];
  locale: string;
  onSave: (key: string, originalText: string, targetText: string) => Promise<SaveOutcome>;
  // Reviewer actions (M2 step 10) -- optional so a caller that only wants
  // the read+edit surface doesn't have to pass no-op handlers; a row's
  // action only appears when both its status calls for it AND the handler
  // exists.
  onClaim?: (key: string) => Promise<ReviewOutcome>;
  onApprove?: (key: string) => Promise<ReviewOutcome>;
  onSendBack?: (key: string, comment: string) => Promise<ReviewOutcome>;
}

/**
 * Keyboard-first, per the M2 outcome: arrow keys move the active cell --
 * the actual reason TanStack Table (headless) won over a grid with
 * baked-in mouse-first UX, since it leaves this entirely up to us to
 * build rather than fighting a pre-built widget's own key handling.
 *
 * Only the target-text column is inline-editable. A save-time conflict
 * (D22, §5) keeps the cell in edit mode with both the draft and the
 * currently-stored value visible, rather than a bare error dialog --
 * "submit anyway" retries with the stored value as the new snapshot
 * (guaranteed to succeed), "cancel" discards the draft.
 *
 * A key whose source is an ICU plural (M2 step 9) opens one slot per
 * CLDR-required branch for `locale` instead of a single field --
 * whichever branches are committed get reassembled into one ICU string
 * (packages/icu) before calling onSave, so the save endpoint itself
 * never needs to know per-branch editing happened.
 */
export function KeyTable({ rows, locale, onSave, onClaim, onApprove, onSendBack }: KeyTableProps) {
  const [active, setActive] = useState({ row: 0, col: 0 });
  const [editing, setEditing] = useState<EditingState | null>(null);
  // Optimistic display state, keyed by key name: the parent's `rows` prop
  // only reflects reality after its own query refetches, which lags
  // behind a save's response -- this is what makes a just-saved cell show
  // the new text and reconciled status immediately. A review action only
  // overrides `status`, so both fields are partial.
  const [overrides, setOverrides] = useState<
    Record<string, Partial<Pick<KeyRow, 'targetText' | 'status'>>>
  >({});
  // Per-key transient state for reviewer actions -- unlike edits, review
  // actions don't need optimistic status (they're a single quick request),
  // so a busy flag + a reconciled-or-error result is enough.
  const [reviewBusy, setReviewBusy] = useState<Record<string, boolean>>({});
  const [reviewErrors, setReviewErrors] = useState<Record<string, string>>({});
  const cellRefs = useRef(new Map<string, HTMLTableCellElement>());

  const displayRows = rows.map((row) =>
    overrides[row.key] ? { ...row, ...overrides[row.key] } : row,
  );
  const table = useReactTable({ data: displayRows, columns, getCoreRowModel: getCoreRowModel() });
  const tableRows = table.getRowModel().rows;
  const columnCount = columns.length;

  useEffect(() => {
    if (editing) return;
    cellRefs.current.get(`${active.row}-${active.col}`)?.focus();
  }, [active, editing]);

  function startEditing(rowIndex: number, row: KeyRow) {
    const pluralState = computePluralEditState(row, locale);
    if (pluralState) {
      const draft: Record<string, string> = {};
      for (const slot of pluralState.slots) draft[slot.category] = slot.text;
      setEditing({
        kind: 'plural',
        status: 'editing',
        rowIndex,
        key: row.key,
        originalText: row.targetText,
        meta: pluralState,
        draft,
      });
    } else {
      setEditing({
        kind: 'plain',
        status: 'editing',
        rowIndex,
        key: row.key,
        originalText: row.targetText,
        draft: row.targetText,
      });
    }
  }

  async function commit(snapshotText: string, current: EditingState) {
    const newText = computeNewText(current);

    if (newText === snapshotText && current.status !== 'conflict') {
      setEditing(null);
      return;
    }

    const { key } = current;
    setEditing({ ...current, status: 'saving' } as EditingState);
    setOverrides((prev) => ({ ...prev, [key]: { targetText: newText, status: 'saving' } }));

    const outcome = await onSave(key, snapshotText, newText);

    if (outcome.kind === 'success') {
      setOverrides((prev) => ({ ...prev, [key]: { targetText: newText, status: outcome.status } }));
      setEditing(null);
    } else if (outcome.kind === 'conflict') {
      setOverrides((prev) => omitKey(prev, key));
      setEditing({
        ...current,
        status: 'conflict',
        currentText: outcome.currentText,
      } as EditingState);
    } else {
      setOverrides((prev) => omitKey(prev, key));
      setEditing({ ...current, status: 'editing', errorMessage: outcome.message } as EditingState);
    }
  }

  async function runReview(key: string, run: () => Promise<ReviewOutcome>) {
    setReviewErrors((prev) => omitKey(prev, key));
    setReviewBusy((prev) => ({ ...prev, [key]: true }));

    const outcome = await run();

    setReviewBusy((prev) => omitKey(prev, key));
    if (outcome.kind === 'success') {
      setOverrides((prev) => ({ ...prev, [key]: { ...prev[key], status: outcome.status } }));
    } else {
      setReviewErrors((prev) => ({ ...prev, [key]: outcome.message }));
    }
  }

  function handleTableKeyDown(e: KeyboardEvent<HTMLTableElement>) {
    if (editing) return;
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        setActive((a) => ({ ...a, row: Math.max(0, a.row - 1) }));
        break;
      case 'ArrowDown':
        e.preventDefault();
        setActive((a) => ({ ...a, row: Math.min(tableRows.length - 1, a.row + 1) }));
        break;
      case 'ArrowLeft':
        e.preventDefault();
        setActive((a) => ({ ...a, col: Math.max(0, a.col - 1) }));
        break;
      case 'ArrowRight':
        e.preventDefault();
        setActive((a) => ({ ...a, col: Math.min(columnCount - 1, a.col + 1) }));
        break;
      case 'Enter':
        if (active.col === TARGET_COLUMN_INDEX) {
          e.preventDefault();
          const row = tableRows[active.row]?.original;
          if (row) startEditing(active.row, row);
        }
        break;
      default:
        break;
    }
  }

  if (tableRows.length === 0) {
    return <p>No keys match the current filters.</p>;
  }

  return (
    <table onKeyDown={handleTableKeyDown}>
      <thead>
        {table.getHeaderGroups().map((headerGroup) => (
          <tr key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <th key={header.id}>
                {flexRender(header.column.columnDef.header, header.getContext())}
              </th>
            ))}
            <th>Actions</th>
          </tr>
        ))}
      </thead>
      <tbody>
        {tableRows.map((row, rowIndex) => {
          const rowKey = row.original.key;
          return (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell, colIndex) => {
                const isActive = active.row === rowIndex && active.col === colIndex;
                const isEditingThisCell =
                  colIndex === TARGET_COLUMN_INDEX && editing?.rowIndex === rowIndex;

                return (
                  <td
                    key={cell.id}
                    ref={(el) => {
                      if (el) {
                        cellRefs.current.set(`${rowIndex}-${colIndex}`, el);
                      } else {
                        cellRefs.current.delete(`${rowIndex}-${colIndex}`);
                      }
                    }}
                    tabIndex={isActive ? 0 : -1}
                    onFocus={() => {
                      if (!editing) setActive({ row: rowIndex, col: colIndex });
                    }}
                    onDoubleClick={() => {
                      if (colIndex === TARGET_COLUMN_INDEX && !editing) {
                        startEditing(rowIndex, row.original);
                      }
                    }}
                  >
                    {isEditingThisCell && editing ? (
                      <TargetCellEditor
                        state={editing}
                        onCommit={commit}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      flexRender(cell.column.columnDef.cell, cell.getContext())
                    )}
                  </td>
                );
              })}
              <td>
                <RowActions
                  status={row.original.status}
                  busy={reviewBusy[rowKey] ?? false}
                  error={reviewErrors[rowKey]}
                  onClaim={onClaim ? () => runReview(rowKey, () => onClaim(rowKey)) : undefined}
                  onApprove={
                    onApprove ? () => runReview(rowKey, () => onApprove(rowKey)) : undefined
                  }
                  onSendBack={
                    onSendBack
                      ? (comment) => runReview(rowKey, () => onSendBack(rowKey, comment))
                      : undefined
                  }
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

interface RowActionsProps {
  status: string;
  busy: boolean;
  error?: string;
  onClaim?: () => void;
  onApprove?: () => void;
  onSendBack?: (comment: string) => void;
}

/**
 * Per-row reviewer controls (M2 step 10): a needs_review row can be
 * claimed; an in_review row can be approved or sent back. Send-back
 * requires a non-empty comment -- the confirm button stays disabled
 * until one is typed (the server enforces this too, per §5, but the UI
 * shouldn't let an empty one through in the first place).
 */
function RowActions({ status, busy, error, onClaim, onApprove, onSendBack }: RowActionsProps) {
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [comment, setComment] = useState('');
  const commentId = useId();

  return (
    <div>
      {status === 'needs_review' && onClaim && (
        <button type="button" disabled={busy} onClick={onClaim}>
          Claim
        </button>
      )}

      {status === 'in_review' && !sendBackOpen && (
        <>
          {onApprove && (
            <button type="button" disabled={busy} onClick={onApprove}>
              Approve
            </button>
          )}
          {onSendBack && (
            <button type="button" disabled={busy} onClick={() => setSendBackOpen(true)}>
              Send back
            </button>
          )}
        </>
      )}

      {status === 'in_review' && sendBackOpen && onSendBack && (
        <div>
          <label htmlFor={commentId}>Comment</label>
          <input id={commentId} value={comment} onChange={(e) => setComment(e.target.value)} />
          <button
            type="button"
            disabled={busy || comment.trim() === ''}
            onClick={() => onSendBack(comment)}
          >
            Confirm send-back
          </button>
          <button
            type="button"
            onClick={() => {
              setSendBackOpen(false);
              setComment('');
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {error && <p role="alert">{error}</p>}
    </div>
  );
}

interface TargetCellEditorProps {
  state: EditingState;
  onCommit: (snapshotText: string, current: EditingState) => void;
  onCancel: () => void;
}

function TargetCellEditor({ state, onCommit, onCancel }: TargetCellEditorProps) {
  if (state.kind === 'plural') {
    return <PluralTargetCellEditor state={state} onCommit={onCommit} onCancel={onCancel} />;
  }
  return <PlainTargetCellEditor state={state} onCommit={onCommit} onCancel={onCancel} />;
}

function PlainTargetCellEditor({
  state,
  onCommit,
  onCancel,
}: {
  state: PlainEditingState;
  onCommit: (snapshotText: string, current: EditingState) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(state.draft);
  const saving = state.status === 'saving';

  if (state.status === 'conflict') {
    return (
      <div>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          // biome-ignore lint/a11y/noAutofocus: opening the editor is itself the user's explicit intent to type immediately.
          autoFocus
        />
        <p>Current value: {state.currentText}</p>
        <button
          type="button"
          onClick={() =>
            onCommit(state.currentText ?? '', { ...state, draft, kind: 'plain' as const })
          }
        >
          Submit anyway
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div>
      <input
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            onCommit(state.originalText, { ...state, draft, kind: 'plain' as const });
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={() => {
          if (!saving) onCommit(state.originalText, { ...state, draft, kind: 'plain' as const });
        }}
        // biome-ignore lint/a11y/noAutofocus: opening the editor is itself the user's explicit intent to type immediately.
        autoFocus
      />
      {state.errorMessage && <p role="alert">{state.errorMessage}</p>}
    </div>
  );
}

function PluralTargetCellEditor({
  state,
  onCommit,
  onCancel,
}: {
  state: PluralEditingState;
  onCommit: (snapshotText: string, current: EditingState) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(state.draft);
  const saving = state.status === 'saving';
  const groupId = useId();
  const groupRef = useRef<HTMLDivElement>(null);

  function commitDraft(snapshotText: string) {
    onCommit(snapshotText, { ...state, draft, kind: 'plural' as const });
  }

  // Blurring one branch input to focus another branch input in this same
  // group isn't "leaving the cell" -- only commit once focus actually
  // moves outside the whole editor, not on every individual field's blur.
  function handleSlotBlur(e: React.FocusEvent<HTMLInputElement>) {
    if (saving) return;
    const nextFocused = e.relatedTarget as Node | null;
    if (nextFocused && groupRef.current?.contains(nextFocused)) return;
    commitDraft(state.originalText);
  }

  if (state.status === 'conflict') {
    return (
      <div>
        <p>Current value: {state.currentText}</p>
        <button type="button" onClick={() => commitDraft(state.currentText ?? '')}>
          Submit anyway
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div ref={groupRef}>
      {state.meta.slots.map((slot) => {
        const inputId = `${groupId}-${slot.category}`;
        return (
          <div key={slot.category}>
            <label htmlFor={inputId}>{slot.category}</label>
            <input
              id={inputId}
              value={draft[slot.category] ?? ''}
              disabled={saving}
              onChange={(e) => setDraft((d) => ({ ...d, [slot.category]: e.target.value }))}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitDraft(state.originalText);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  onCancel();
                }
              }}
              onBlur={handleSlotBlur}
            />
            {slot.isFallback && slot.category !== 'other' && (
              <span>(falls back to the other branch at render time)</span>
            )}
          </div>
        );
      })}
      {state.errorMessage && <p role="alert">{state.errorMessage}</p>}
    </div>
  );
}
