import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { KeyRow } from './api';

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
};

function StatusBadge({ status }: { status: string }) {
  return <span style={STATUS_STYLES[status] ?? {}}>{status.replace(/_/g, ' ')}</span>;
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

export interface KeyTableProps {
  rows: KeyRow[];
}

/**
 * Keyboard-first, per the M2 outcome: arrow keys move the active cell --
 * the actual reason TanStack Table (headless) won over a grid with
 * baked-in mouse-first UX, since it leaves this entirely up to us to
 * build rather than fighting a pre-built widget's own key handling.
 */
export function KeyTable({ rows }: KeyTableProps) {
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });
  const tableRows = table.getRowModel().rows;
  const columnCount = columns.length;

  const [active, setActive] = useState({ row: 0, col: 0 });
  const cellRefs = useRef(new Map<string, HTMLTableCellElement>());

  useEffect(() => {
    cellRefs.current.get(`${active.row}-${active.col}`)?.focus();
  }, [active]);

  function handleKeyDown(e: KeyboardEvent<HTMLTableElement>) {
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
      default:
        break;
    }
  }

  if (tableRows.length === 0) {
    return <p>No keys match the current filters.</p>;
  }

  return (
    <table onKeyDown={handleKeyDown}>
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
                  onFocus={() => setActive({ row: rowIndex, col: colIndex })}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
