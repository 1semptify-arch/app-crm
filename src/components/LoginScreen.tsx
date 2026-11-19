import { useState } from 'react';
import { signInToDrive } from '../lib/driveStore';
import { signIn, signUp } from '../lib/supabaseStore';
import { Field, PrimaryButton, inputClass } from './ui';

export function LoginScreen({
  onSignedIn,
  drive,
}: {
  onSignedIn: () => void;
  drive?: boolean;
}) {
  if (drive) return <DriveSignIn onSignedIn={onSignedIn} />;
  return <SupabaseSignIn onSignedIn={onSignedIn} />;
}

function DriveSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-6">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            Sign in to save to your Drive
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Your data stays in your Google Drive — not on our servers.
          </p>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <PrimaryButton
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            signInToDrive()
              .then(onSignedIn)
              .catch((e) =>
                setError(e instanceof Error ? e.message : 'Sign in failed.'),
              )
              .finally(() => setBusy(false));
          }}
        >
          {busy ? 'Working…' : 'Continue with Google'}
        </PrimaryButton>
      </div>
    </div>
  );
}

function SupabaseSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'signin') {
        await signIn(email, password);
        onSignedIn();
      } else {
        await signUp(email, password);
        setNotice('Account created. If email confirmation is on, check your inbox, then sign in.');
        setMode('signin');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-6">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">CRM</h1>
          <p className="mt-1 text-sm text-gray-500">Sign in to sync your data.</p>
        </div>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Email">
            <input
              className={inputClass}
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Password">
            <input
              className={inputClass}
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {notice && <p className="text-sm text-green-600">{notice}</p>}
          <PrimaryButton type="submit" disabled={busy}>
            {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </PrimaryButton>
        </form>
        <button
          type="button"
          onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
          className="text-sm text-indigo-600 hover:underline"
        >
          {mode === 'signin' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}
