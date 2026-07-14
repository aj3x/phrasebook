import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { KeyTable } from '../src/KeyTable';
import type { KeyRow, SaveOutcome } from '../src/api';

const rows: KeyRow[] = [
  { key: 'a.b', sourceText: 'A', targetText: 'A-fr', status: 'approved' },
  { key: 'c.d', sourceText: 'C', targetText: '', status: 'untranslated' },
  { key: 'e.f', sourceText: 'E', targetText: 'E-mt', status: 'machine_translated' },
];

function neverUsedOnSave(): Promise<SaveOutcome> {
  throw new Error('onSave should not be called in this test');
}

describe('KeyTable', () => {
  test('renders a row per key with source/target/status', () => {
    render(<KeyTable rows={rows} onSave={neverUsedOnSave} />);

    screen.getByText('a.b');
    screen.getByText('A-fr');
    screen.getByText('approved');
    screen.getByText('machine translated');
  });

  test('shows a message when there are no keys matching the filters', () => {
    render(<KeyTable rows={[]} onSave={neverUsedOnSave} />);

    screen.getByText(/no keys match/i);
  });

  test('the first cell is focusable without any prior interaction', () => {
    render(<KeyTable rows={rows} onSave={neverUsedOnSave} />);

    const firstCell = screen.getByText('a.b').closest('td');
    expect(firstCell).toHaveProperty('tabIndex', 0);
  });

  test('arrow keys move the active (focused) cell', () => {
    render(<KeyTable rows={rows} onSave={neverUsedOnSave} />);

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
    render(<KeyTable rows={rows} onSave={neverUsedOnSave} />);

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

    render(<KeyTable rows={manyRows} onSave={neverUsedOnSave} />);

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

  describe('inline editing', () => {
    test('double-clicking the target cell opens an editable field with the current value', () => {
      render(<KeyTable rows={rows} onSave={neverUsedOnSave} />);

      fireEvent.doubleClick(screen.getByText('A-fr'));

      expect(screen.getByRole('textbox')).toHaveProperty('value', 'A-fr');
    });

    test('pressing Enter while the target cell is focused (not editing) opens the editable field', () => {
      render(<KeyTable rows={rows} onSave={neverUsedOnSave} />);

      const targetCell = screen.getByText('A-fr').closest('td') as HTMLElement;
      // fireEvent.focus (not the raw DOM .focus()) so the resulting
      // setActive() is flushed under act() before the next line runs.
      fireEvent.focus(targetCell);
      fireEvent.keyDown(targetCell, { key: 'Enter' });

      expect(screen.getByRole('textbox')).toHaveProperty('value', 'A-fr');
    });

    test('committing with Enter calls onSave and shows the reconciled status on success', async () => {
      const onSave = vi.fn(
        async (): Promise<SaveOutcome> => ({ kind: 'success', status: 'needs_review' }),
      );
      render(<KeyTable rows={rows} onSave={onSave} />);

      fireEvent.doubleClick(screen.getByText('A-fr'));
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'A-fr updated' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onSave).toHaveBeenCalledWith('a.b', 'A-fr', 'A-fr updated');

      await waitFor(() => {
        expect(screen.queryByRole('textbox')).toBeNull();
        screen.getByText('A-fr updated');
        screen.getByText('needs review');
      });
    });

    test('shows an optimistic "saving" status before the save resolves', async () => {
      let resolveSave: (outcome: SaveOutcome) => void = () => {};
      const onSave = vi.fn(
        () =>
          new Promise<SaveOutcome>((resolve) => {
            resolveSave = resolve;
          }),
      );
      render(<KeyTable rows={rows} onSave={onSave} />);

      fireEvent.doubleClick(screen.getByText('A-fr'));
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'A-fr updated' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => screen.getByText(/saving/i));

      resolveSave({ kind: 'success', status: 'approved' });

      await waitFor(() => {
        expect(screen.queryByText(/saving/i)).toBeNull();
        screen.getByText('approved');
      });
    });

    test('committing on blur also saves', async () => {
      const onSave = vi.fn(
        async (): Promise<SaveOutcome> => ({ kind: 'success', status: 'approved' }),
      );
      render(<KeyTable rows={rows} onSave={onSave} />);

      fireEvent.doubleClick(screen.getByText('A-fr'));
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'A-fr updated' } });
      fireEvent.blur(input);

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith('a.b', 'A-fr', 'A-fr updated');
      });
    });

    test('Escape cancels the edit without calling onSave', () => {
      render(<KeyTable rows={rows} onSave={neverUsedOnSave} />);

      fireEvent.doubleClick(screen.getByText('A-fr'));
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'discarded draft' } });
      fireEvent.keyDown(input, { key: 'Escape' });

      expect(screen.queryByRole('textbox')).toBeNull();
      screen.getByText('A-fr');
    });

    test('a conflict shows the stored value and lets the user submit over it', async () => {
      const onSave = vi
        .fn<() => Promise<SaveOutcome>>()
        .mockResolvedValueOnce({ kind: 'conflict', currentText: 'A-fr (someone else)' })
        .mockResolvedValueOnce({ kind: 'success', status: 'needs_review' });
      render(<KeyTable rows={rows} onSave={onSave} />);

      fireEvent.doubleClick(screen.getByText('A-fr'));
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'my draft' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => {
        screen.getByText('A-fr (someone else)', { exact: false });
      });

      fireEvent.click(screen.getByRole('button', { name: /submit anyway/i }));

      expect(onSave).toHaveBeenLastCalledWith('a.b', 'A-fr (someone else)', 'my draft');

      await waitFor(() => {
        expect(screen.queryByRole('textbox')).toBeNull();
        screen.getByText('needs review');
      });
    });

    test('cancelling a conflict reverts to the stored value without saving again', async () => {
      const onSave = vi.fn(
        async (): Promise<SaveOutcome> => ({
          kind: 'conflict',
          currentText: 'A-fr (someone else)',
        }),
      );
      render(<KeyTable rows={rows} onSave={onSave} />);

      fireEvent.doubleClick(screen.getByText('A-fr'));
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'my draft' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => {
        screen.getByRole('button', { name: /cancel/i });
      });

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('textbox')).toBeNull();
      screen.getByText('A-fr');
    });
  });
});
