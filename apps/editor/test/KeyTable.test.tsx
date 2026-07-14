import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { KeyTable } from '../src/KeyTable';
import type { KeyRow } from '../src/api';

const rows: KeyRow[] = [
  { key: 'a.b', sourceText: 'A', targetText: 'A-fr', status: 'approved' },
  { key: 'c.d', sourceText: 'C', targetText: '', status: 'untranslated' },
  { key: 'e.f', sourceText: 'E', targetText: 'E-mt', status: 'machine_translated' },
];

describe('KeyTable', () => {
  test('renders a row per key with source/target/status', () => {
    render(<KeyTable rows={rows} />);

    screen.getByText('a.b');
    screen.getByText('A-fr');
    screen.getByText('approved');
    screen.getByText('machine translated');
  });

  test('shows a message when there are no keys matching the filters', () => {
    render(<KeyTable rows={[]} />);

    screen.getByText(/no keys match/i);
  });

  test('the first cell is focusable without any prior interaction', () => {
    render(<KeyTable rows={rows} />);

    const firstCell = screen.getByText('a.b').closest('td');
    expect(firstCell).toHaveProperty('tabIndex', 0);
  });

  test('arrow keys move the active (focused) cell', () => {
    render(<KeyTable rows={rows} />);

    const firstCell = screen.getByText('a.b').closest('td') as HTMLElement;
    firstCell.focus();
    expect(document.activeElement).toBe(firstCell);

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
    const secondRowKeyCell = screen.getByText('c.d').closest('td');
    expect(document.activeElement).toBe(secondRowKeyCell);

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByText('C').closest('td'));

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByText('A').closest('td'));

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(screen.getByText('a.b').closest('td'));
  });

  test('arrow keys do not move past the edges of the grid', () => {
    render(<KeyTable rows={rows} />);

    const firstCell = screen.getByText('a.b').closest('td') as HTMLElement;
    firstCell.focus();

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(firstCell);

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(firstCell);
  });

  test('renders correctly at 50+ rows, and arrow keys still navigate to the last row', () => {
    const manyRows: KeyRow[] = Array.from({ length: 55 }, (_, i) => ({
      key: `key.${i}`,
      sourceText: `Source ${i}`,
      targetText: `Target ${i}`,
      status: 'approved',
    }));

    render(<KeyTable rows={manyRows} />);

    screen.getByText('key.0');
    screen.getByText('key.54');
    expect(screen.getAllByText('approved')).toHaveLength(55);

    const firstCell = screen.getByText('key.0').closest('td') as HTMLElement;
    firstCell.focus();
    for (let i = 0; i < 54; i++) {
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
    }
    expect(document.activeElement).toBe(screen.getByText('key.54').closest('td'));
  });
});
