import type { FormatValues } from '@phrasebook/core';
import { useCallback, useContext } from 'react';
import { PhrasebookContext } from './context';

export function useT(): (key: string, values?: FormatValues) => string {
  const ctx = useContext(PhrasebookContext);
  if (!ctx) {
    throw new Error('useT must be used within a PhrasebookProvider');
  }

  const { client } = ctx;
  return useCallback((key: string, values?: FormatValues) => client.t(key, values), [client]);
}
