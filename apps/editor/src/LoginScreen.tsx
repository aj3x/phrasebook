import { type FormEvent, useId, useState } from 'react';
import type { AuthClient } from './auth-client';

export interface LoginScreenProps {
  authClient: Pick<AuthClient, 'signIn'>;
}

export function LoginScreen({ authClient }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const emailId = useId();
  const passwordId = useId();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const result = await authClient.signIn.email({ email, password });

    setSubmitting(false);
    if (result.error) {
      setError(result.error.message ?? 'Sign in failed');
    }
    // On success, the auth client's session store updates on its own --
    // whatever renders based on useSession() picks it up without this
    // component needing to know or care.
  }

  return (
    <main>
      <h1>Phrasebook</h1>
      <form onSubmit={handleSubmit}>
        <label htmlFor={emailId}>
          Email
          <input
            id={emailId}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label htmlFor={passwordId}>
          Password
          <input
            id={passwordId}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
    </main>
  );
}
