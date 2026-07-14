import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { KeyRow, SaveOutcome } from './api';

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

type EditingState =
  | {
      mode: 'editing' | 'saving';
      rowIndex: number;
      key: string;
      originalText: string;
      draft: string;
      errorMessage?: string;
    }
  | {
      mode: 'conflict';
      rowIndex: number;
      key: string;
      originalText: string;
      draft: string;
      currentText: string;
    };

export interface KeyTableProps {
  rows: KeyRow[];
  onSave: (key: string, originalText: string, targetText: string) => Promise<SaveOutcome>;
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
 */
export function KeyTable({ rows, onSave }: KeyTableProps) {
  const [active, setActive] = useState({ row: 0, col: 0 });
  const [editing, setEditing] = useState<EditingState | null>(null);
  // Optimistic display state, keyed by key name: the parent's `rows` prop
  // only reflects reality after its own query refetches, which lags
  // behind a save's response -- this is what makes a just-saved cell show
  // the new text and reconciled status immediately.
  const [overrides, setOverrides] = useState<Record<string, Pick<KeyRow, 'targetText' | 'status'>>>(
    {},
  );
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
    setEditing({
      mode: 'editing',
      rowIndex,
      key: row.key,
      originalText: row.targetText,
      draft: row.targetText,
    });
  }

  async function commit(snapshotText: string, draft: string) {
    if (!editing) return;
    if (draft === snapshotText && editing.mode !== 'conflict') {
      setEditing(null);
      return;
    }

    const { rowIndex, key } = editing;
    setEditing({ mode: 'saving', rowIndex, key, originalText: snapshotText, draft });
    setOverrides((prev) => ({ ...prev, [key]: { targetText: draft, status: 'saving' } }));

    const outcome = await onSave(key, snapshotText, draft);

    if (outcome.kind === 'success') {
      setOverrides((prev) => ({ ...prev, [key]: { targetText: draft, status: outcome.status } }));
      setEditing(null);
    } else if (outcome.kind === 'conflict') {
      setOverrides((prev) => omitKey(prev, key));
      setEditing({
        mode: 'conflict',
        rowIndex,
        key,
        originalText: snapshotText,
        draft,
        currentText: outcome.currentText,
      });
    } else {
      setOverrides((prev) => omitKey(prev, key));
      setEditing({
        mode: 'editing',
        rowIndex,
        key,
        originalText: snapshotText,
        draft,
        errorMessage: outcome.message,
      });
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
          </tr>
        ))}
      </thead>
      <tbody>
        {tableRows.map((row, rowIndex) => (
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
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface TargetCellEditorProps {
  state: EditingState;
  onCommit: (snapshotText: string, draft: string) => void;
  onCancel: () => void;
}

function TargetCellEditor({ state, onCommit, onCancel }: TargetCellEditorProps) {
  const [draft, setDraft] = useState(state.draft);

  if (state.mode === 'conflict') {
    return (
      <div>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          // biome-ignore lint/a11y/noAutofocus: opening the editor is itself the user's explicit intent to type immediately.
          autoFocus
        />
        <p>Current value: {state.currentText}</p>
        <button type="button" onClick={() => onCommit(state.currentText, draft)}>
          Submit anyway
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  }

  const saving = state.mode === 'saving';

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
            onCommit(state.originalText, draft);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={() => {
          if (!saving) onCommit(state.originalText, draft);
        }}
        // biome-ignore lint/a11y/noAutofocus: opening the editor is itself the user's explicit intent to type immediately.
        autoFocus
      />
      {state.errorMessage && <p role="alert">{state.errorMessage}</p>}
    </div>
  );
}
