import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { KeyTable, type KeyTableProps } from '../src/KeyTable';
import type { KeyRow, ReviewOutcome, SaveOutcome } from '../src/api';

const rows: KeyRow[] = [
  { key: 'a.b', sourceText: 'A', targetText: 'A-fr', status: 'approved' },
  { key: 'c.d', sourceText: 'C', targetText: '', status: 'untranslated' },
  { key: 'e.f', sourceText: 'E', targetText: 'E-mt', status: 'machine_translated' },
];

function neverUsedOnSave(): Promise<SaveOutcome> {
  throw new Error('onSave should not be called in this test');
}

function getTargetCell(keyText: string): Element {
  const row = screen.getByText(keyText).closest('tr');
  const cell = row?.children[2];
  if (!cell) throw new Error(`expected a target-text cell for row "${keyText}"`);
  return cell;
}

describe('KeyTable', () => {
  test('renders a row per key with source/target/status', () => {
    render(<KeyTable rows={rows} onSave={neverUsedOnSave} locale="fr" />);

    screen.getByText('a.b');
    screen.getByText('A-fr');
    screen.getByText('approved');
    screen.getByText('machine translated');
  });

  test('shows a message when there are no keys matching the filters', () => {
    render(<KeyTable rows={[]} onSave={neverUsedOnSave} locale="fr" />);

    screen.getByText(/no keys match/i);
  });

  test('the first cell is focusable without any prior interaction', () => {
    render(<KeyTable rows={rows} onSave={neverUsedOnSave} locale="fr" />);

    const firstCell = screen.getByText('a.b').closest('td');
    expect(firstCell).toHaveProperty('tabIndex', 0);
  });

  test('arrow keys move the active (focused) cell', () => {
    render(<KeyTable rows={rows} onSave={neverUsedOnSave} locale="fr" />);

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
    render(<KeyTable rows={rows} onSave={neverUsedOnSave} locale="fr" />);

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

    render(<KeyTable rows={manyRows} onSave={neverUsedOnSave} locale="fr" />);

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
      render(<KeyTable rows={rows} onSave={neverUsedOnSave} locale="fr" />);

      fireEvent.doubleClick(screen.getByText('A-fr'));

      expect(screen.getByRole('textbox')).toHaveProperty('value', 'A-fr');
    });

    test('pressing Enter while the target cell is focused (not editing) opens the editable field', () => {
      render(<KeyTable rows={rows} onSave={neverUsedOnSave} locale="fr" />);

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
      render(<KeyTable rows={rows} onSave={onSave} locale="fr" />);

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
      render(<KeyTable rows={rows} onSave={onSave} locale="fr" />);

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
      render(<KeyTable rows={rows} onSave={onSave} locale="fr" />);

      fireEvent.doubleClick(screen.getByText('A-fr'));
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'A-fr updated' } });
      fireEvent.blur(input);

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith('a.b', 'A-fr', 'A-fr updated');
      });
    });

    test('Escape cancels the edit without calling onSave', () => {
      render(<KeyTable rows={rows} onSave={neverUsedOnSave} locale="fr" />);

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
      render(<KeyTable rows={rows} onSave={onSave} locale="fr" />);

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
      render(<KeyTable rows={rows} onSave={onSave} locale="fr" />);

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

  describe('ICU plural per-branch editing', () => {
    const pluralRows: KeyRow[] = [
      {
        key: 'cart.items',
        sourceText: '{count, plural, one {# item} other {# items}}',
        targetText: '',
        status: 'untranslated',
      },
    ];

    test('opens one slot per CLDR-required category for the target locale, not a single field', () => {
      render(<KeyTable rows={pluralRows} onSave={neverUsedOnSave} locale="ar" />);

      fireEvent.doubleClick(getTargetCell('cart.items'));

      const textboxes = screen.getAllByRole('textbox');
      expect(textboxes).toHaveLength(6);
      screen.getByLabelText('zero');
      screen.getByLabelText('other');
    });

    test('a category absent from the (untranslated) target is visually flagged as falling back, except "other" itself', () => {
      render(<KeyTable rows={pluralRows} onSave={neverUsedOnSave} locale="ar" />);

      fireEvent.doubleClick(getTargetCell('cart.items'));

      // The target is untranslated (empty), so every category including
      // "one" is unfilled in the target -- only "other" itself never shows
      // the hint (it wouldn't make sense to say "other falls back to
      // other").
      expect(screen.getAllByText(/falls back to.*other/i)).toHaveLength(5);
    });

    test('committing reassembles the branches into one ICU message and saves it', async () => {
      const onSave = vi.fn<
        (key: string, originalText: string, targetText: string) => Promise<SaveOutcome>
      >(async () => ({ kind: 'success', status: 'needs_review' }));
      render(<KeyTable rows={pluralRows} onSave={onSave} locale="ar" />);

      fireEvent.doubleClick(getTargetCell('cart.items'));

      const oneInput = screen.getByLabelText('one');
      fireEvent.change(oneInput, { target: { value: '# item' } });
      const otherInput = screen.getByLabelText('other');
      fireEvent.change(otherInput, { target: { value: '# items' } });
      fireEvent.keyDown(otherInput, { key: 'Enter' });

      await waitFor(() => {
        expect(onSave).toHaveBeenCalled();
      });

      const call = onSave.mock.calls[0];
      expect(call).toBeDefined();
      if (!call) throw new Error('expected onSave to have been called');
      const [key, originalText, newText] = call;
      expect(key).toBe('cart.items');
      expect(originalText).toBe('');
      expect(newText).toContain('one{# item}');
      expect(newText).toContain('other{# items}');
    });

    test('moving focus between branch inputs does not trigger a premature save', () => {
      render(<KeyTable rows={pluralRows} onSave={neverUsedOnSave} locale="ar" />);

      fireEvent.doubleClick(getTargetCell('cart.items'));

      const oneInput = screen.getByLabelText('one');
      const otherInput = screen.getByLabelText('other');
      fireEvent.change(oneInput, { target: { value: '# item' } });
      // Blurring to focus a sibling slot in the same editor isn't "leaving
      // the cell" -- neverUsedOnSave would throw if this triggered a save.
      fireEvent.blur(oneInput, { relatedTarget: otherInput });

      // Still editing: the field we just typed into keeps its draft value.
      expect(screen.getByLabelText('one')).toHaveProperty('value', '# item');
    });

    test('a plain (non-plural) key still shows a single input, not per-branch slots', () => {
      render(<KeyTable rows={rows} onSave={neverUsedOnSave} locale="ar" />);

      fireEvent.doubleClick(screen.getByText('A-fr'));

      expect(screen.getAllByRole('textbox')).toHaveLength(1);
    });
  });

  describe('reviewer actions', () => {
    const reviewRows: KeyRow[] = [
      { key: 'k.needs', sourceText: 'S1', targetText: 'T1', status: 'needs_review' },
      { key: 'k.inreview', sourceText: 'S2', targetText: 'T2', status: 'in_review' },
      { key: 'k.approved', sourceText: 'S3', targetText: 'T3', status: 'approved' },
    ];

    function rowFor(keyText: string): HTMLElement {
      const row = screen.getByText(keyText).closest('tr');
      if (!row) throw new Error(`no row for "${keyText}"`);
      return row as HTMLElement;
    }

    // ProjectView always wires all three handlers; these defaults mirror
    // that so a test overrides only the one it's asserting.
    const okClaim = async (): Promise<ReviewOutcome> => ({ kind: 'success', status: 'in_review' });
    const okApprove = async (): Promise<ReviewOutcome> => ({ kind: 'success', status: 'approved' });
    const okSendBack = async (): Promise<ReviewOutcome> => ({
      kind: 'success',
      status: 'needs_review',
    });

    function renderReview(
      handlers: {
        onClaim?: KeyTableProps['onClaim'];
        onApprove?: KeyTableProps['onApprove'];
        onSendBack?: KeyTableProps['onSendBack'];
      } = {},
    ) {
      return render(
        <KeyTable
          rows={reviewRows}
          onSave={neverUsedOnSave}
          locale="fr"
          onClaim={handlers.onClaim ?? okClaim}
          onApprove={handlers.onApprove ?? okApprove}
          onSendBack={handlers.onSendBack ?? okSendBack}
        />,
      );
    }

    test('shows a Claim action only for needs_review rows', () => {
      renderReview();

      expect(within(rowFor('k.needs')).queryByRole('button', { name: /claim/i })).not.toBeNull();
      expect(within(rowFor('k.inreview')).queryByRole('button', { name: /claim/i })).toBeNull();
      expect(within(rowFor('k.approved')).queryByRole('button', { name: /claim/i })).toBeNull();
    });

    test('shows Approve and Send back actions only for in_review rows', () => {
      renderReview();

      const inReview = within(rowFor('k.inreview'));
      expect(inReview.queryByRole('button', { name: /approve/i })).not.toBeNull();
      expect(inReview.queryByRole('button', { name: /send back/i })).not.toBeNull();

      expect(within(rowFor('k.needs')).queryByRole('button', { name: /approve/i })).toBeNull();
      expect(within(rowFor('k.approved')).queryByRole('button', { name: /approve/i })).toBeNull();
    });

    test('claiming calls onClaim and moves the row to in_review', async () => {
      const onClaim = vi.fn(
        async (): Promise<ReviewOutcome> => ({ kind: 'success', status: 'in_review' }),
      );
      renderReview({ onClaim });

      fireEvent.click(within(rowFor('k.needs')).getByRole('button', { name: /claim/i }));

      expect(onClaim).toHaveBeenCalledWith('k.needs');
      await waitFor(() => {
        // Now in_review, so the claim button is gone and approve/send-back appear.
        expect(within(rowFor('k.needs')).queryByRole('button', { name: /claim/i })).toBeNull();
        within(rowFor('k.needs')).getByRole('button', { name: /approve/i });
      });
    });

    test('approving calls onApprove and moves the row to approved', async () => {
      const onApprove = vi.fn(
        async (): Promise<ReviewOutcome> => ({ kind: 'success', status: 'approved' }),
      );
      renderReview({ onApprove });

      fireEvent.click(within(rowFor('k.inreview')).getByRole('button', { name: /approve/i }));

      expect(onApprove).toHaveBeenCalledWith('k.inreview');
      await waitFor(() => {
        expect(within(rowFor('k.inreview')).queryByRole('button', { name: /approve/i })).toBeNull();
      });
    });

    test('send-back requires a non-empty comment before it can be confirmed', () => {
      renderReview();

      fireEvent.click(within(rowFor('k.inreview')).getByRole('button', { name: /send back/i }));

      const confirm = within(rowFor('k.inreview')).getByRole('button', {
        name: /confirm send-back/i,
      });
      expect(confirm).toHaveProperty('disabled', true);

      fireEvent.change(within(rowFor('k.inreview')).getByLabelText(/comment/i), {
        target: { value: 'please fix the tone' },
      });
      expect(confirm).toHaveProperty('disabled', false);
    });

    test('confirming send-back calls onSendBack with the comment and moves the row to needs_review', async () => {
      const onSendBack = vi.fn(
        async (): Promise<ReviewOutcome> => ({ kind: 'success', status: 'needs_review' }),
      );
      renderReview({ onSendBack });

      fireEvent.click(within(rowFor('k.inreview')).getByRole('button', { name: /send back/i }));
      fireEvent.change(within(rowFor('k.inreview')).getByLabelText(/comment/i), {
        target: { value: 'please fix the tone' },
      });
      fireEvent.click(
        within(rowFor('k.inreview')).getByRole('button', { name: /confirm send-back/i }),
      );

      expect(onSendBack).toHaveBeenCalledWith('k.inreview', 'please fix the tone');
      await waitFor(() => {
        within(rowFor('k.inreview')).getByRole('button', { name: /claim/i });
      });
    });

    test('a rejected approve (self-approval SoD) shows the error and leaves the row in_review', async () => {
      const onApprove = vi.fn(
        async (): Promise<ReviewOutcome> => ({
          kind: 'error',
          message: 'You cannot approve a translation you edited yourself',
        }),
      );
      renderReview({ onApprove });

      fireEvent.click(within(rowFor('k.inreview')).getByRole('button', { name: /approve/i }));

      await waitFor(() => {
        within(rowFor('k.inreview')).getByText(/cannot approve a translation you edited/i);
      });
      // Still in_review: approve button is still there.
      within(rowFor('k.inreview')).getByRole('button', { name: /approve/i });
    });
  });
});
