import type { Client } from '@phrasebook/core';
import { createContext } from 'react';

export interface PhrasebookContextValue {
  client: Client;
  locale: string;
  onLocaleChange?: (locale: string) => void;
}

export const PhrasebookContext = createContext<PhrasebookContextValue | undefined>(undefined);
