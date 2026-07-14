import { describe, expect, test } from 'bun:test';
import {
  InvalidTransitionError,
  approve,
  claimForReview,
  deprecate,
  markNeedsUpdate,
  restore,
  sendBack,
  statusAfterSave,
} from '../src/status';

describe('statusAfterSave', () => {
  test('a save under auto-approve goes straight to approved', () => {
    expect(statusAfterSave(true)).toBe('approved');
  });

  test('a save with auto-approve off goes to needs_review', () => {
    expect(statusAfterSave(false)).toBe('needs_review');
  });
});

describe('claimForReview', () => {
  test('claims an unclaimed needs_review translation', () => {
    expect(claimForReview('needs_review')).toBe('in_review');
  });

  test('claims an untouched machine_translated translation', () => {
    expect(claimForReview('machine_translated')).toBe('in_review');
  });

  test('rejects claiming an already-approved translation', () => {
    expect(() => claimForReview('approved')).toThrow(InvalidTransitionError);
  });

  test('rejects claiming an untranslated key', () => {
    expect(() => claimForReview('untranslated')).toThrow(InvalidTransitionError);
  });
});

describe('approve', () => {
  test('approves a claimed (in_review) translation', () => {
    expect(approve('in_review')).toBe('approved');
  });

  test('rejects approving a translation that was never claimed', () => {
    expect(() => approve('needs_review')).toThrow(InvalidTransitionError);
  });
});

describe('sendBack', () => {
  test('sends a claimed translation back to needs_review with a comment', () => {
    expect(sendBack('in_review', 'Please fix the tone here.')).toBe('needs_review');
  });

  test('rejects a send-back with an empty comment', () => {
    expect(() => sendBack('in_review', '')).toThrow(InvalidTransitionError);
  });

  test('rejects a send-back with a whitespace-only comment', () => {
    expect(() => sendBack('in_review', '   ')).toThrow(InvalidTransitionError);
  });

  test('rejects sending back a translation that was never claimed', () => {
    expect(() => sendBack('needs_review', 'a comment')).toThrow(InvalidTransitionError);
  });
});

describe('markNeedsUpdate', () => {
  test('marks an approved translation as needing an update', () => {
    expect(markNeedsUpdate('approved')).toBe('needs_update');
  });

  test('marks a published translation as needing an update', () => {
    expect(markNeedsUpdate('published')).toBe('needs_update');
  });

  test('rejects marking an untranslated key as needing an update', () => {
    expect(() => markNeedsUpdate('untranslated')).toThrow(InvalidTransitionError);
  });
});

describe('deprecate', () => {
  test('deprecates a translation from any non-deprecated status', () => {
    expect(deprecate('approved')).toBe('deprecated');
    expect(deprecate('untranslated')).toBe('deprecated');
  });

  test('rejects deprecating an already-deprecated translation', () => {
    expect(() => deprecate('deprecated')).toThrow(InvalidTransitionError);
  });
});

describe('restore', () => {
  test('restores to the prior status', () => {
    expect(restore('approved')).toBe('approved');
    expect(restore('needs_review')).toBe('needs_review');
  });

  test('rejects restoring to the deprecated status itself', () => {
    expect(() => restore('deprecated')).toThrow(InvalidTransitionError);
  });
});
