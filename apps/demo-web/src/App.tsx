import type { Client } from '@phrasebook/core';
import { PhrasebookProvider, useT } from '@phrasebook/react';
import { Suspense, useId, useState } from 'react';

const LOCALES = ['en', 'fr', 'fr-CA', 'es'] as const;
const KEYS = ['home.hero.title', 'home.hero.subtitle', 'cart.items'] as const;

export interface AppProps {
  client: Client;
  endpoint: string;
  project: string;
  namespace: string;
}

export function App({ client, endpoint, project, namespace }: AppProps) {
  const [locale, setLocale] = useState<string>('en');
  const [count, setCount] = useState(1);
  const localeId = useId();
  const countId = useId();

  return (
    <main>
      <h1>Phrasebook demo</h1>

      <label htmlFor={localeId}>
        Locale
        <select id={localeId} value={locale} onChange={(e) => setLocale(e.target.value)}>
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </label>

      <label htmlFor={countId}>
        Item count
        <input
          id={countId}
          type="number"
          min={0}
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
        />
      </label>

      <Suspense fallback={<p>Loading...</p>}>
        <PhrasebookProvider client={client} locale={locale} onLocaleChange={setLocale}>
          <Content count={count} />
          <DebugPanel
            client={client}
            locale={locale}
            endpoint={endpoint}
            project={project}
            namespace={namespace}
          />
        </PhrasebookProvider>
      </Suspense>
    </main>
  );
}

function Content({ count }: { count: number }) {
  const t = useT();
  return (
    <section>
      <h2>{t('home.hero.title')}</h2>
      <p>{t('home.hero.subtitle')}</p>
      <p>{t('cart.items', { count })}</p>
    </section>
  );
}

function DebugPanel({
  client,
  locale,
  endpoint,
  project,
  namespace,
}: {
  client: Client;
  locale: string;
  endpoint: string;
  project: string;
  namespace: string;
}) {
  return (
    <aside>
      <h2>Debug</h2>
      <p>Requested locale: {locale}</p>
      <ul>
        {KEYS.map((key) => (
          <li key={key}>
            {key}: resolved via {client.resolvedLocale(key) ?? '(not found)'}
          </li>
        ))}
      </ul>
      <p>Request URL: {`${endpoint}/v1/runtime/${project}/${locale}/${namespace}`}</p>
    </aside>
  );
}
