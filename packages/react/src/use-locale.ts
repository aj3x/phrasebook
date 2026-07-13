import { useCallback, useContext } from 'react';
import { PhrasebookContext } from './context';

export function useLocale(): [string, (locale: string) => void] {
  const ctx = useContext(PhrasebookContext);
  if (!ctx) {
    throw new Error('useLocale must be used within a PhrasebookProvider');
  }

  const { locale, onLocaleChange } = ctx;
  const setLocale = useCallback(
    (next: string) => {
      onLocaleChange?.(next);
    },
    [onLocaleChange],
  );

  return [locale, setLocale];
}
