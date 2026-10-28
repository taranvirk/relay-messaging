import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Check, LockKeyhole, Radio, ShieldCheck, Waves } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Brand } from './Brand';

export function AuthShell({ mode }: { mode: 'login' | 'register' }) {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/messages" replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const data = new FormData(event.currentTarget);
    try {
      if (mode === 'login')
        await login({ email: String(data.get('email')), password: String(data.get('password')) });
      else
        await register({
          email: String(data.get('email')),
          password: String(data.get('password')),
          username: String(data.get('username')),
          displayName: String(data.get('displayName')),
        });
      const redirect = (location.state as { from?: string } | null)?.from ?? '/messages';
      navigate(redirect, { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const isRegister = mode === 'register';
  return (
    <main className="min-h-screen bg-ink text-white lg:grid lg:grid-cols-[1.05fr_.95fr]">
      <section className="relative hidden min-h-screen overflow-hidden border-r border-white/10 bg-panel p-12 lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 auth-grid opacity-40" />
        <div className="relative flex items-center gap-3 font-display text-xl font-bold">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-signal text-ink">
            <Radio />
          </span>{' '}
          Relay
        </div>
        <div className="relative max-w-xl">
          <p className="mb-5 font-mono text-xs uppercase tracking-[.28em] text-signal">
            Live channel / protected
          </p>
          <h1 className="font-display text-5xl font-bold leading-[1.06] tracking-[-.04em]">
            Stay close to the work that’s moving.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-mist">
            A focused messaging space with reliable delivery, live presence, and the conversation
            history your team depends on.
          </p>
        </div>
        <div className="relative grid grid-cols-3 gap-4">
          {[
            { label: 'Durable', Icon: ShieldCheck },
            { label: 'Real-time', Icon: Waves },
            { label: 'Private', Icon: LockKeyhole },
          ].map(({ label, Icon }) => (
            <div key={label} className="border-t border-white/10 pt-4 text-sm text-mist">
              <Icon className="mb-2 text-signal" size={18} />
              {label}
            </div>
          ))}
        </div>
      </section>
      <section className="flex min-h-screen items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          <div className="mb-12 lg:hidden">
            <Brand />
          </div>
          <p className="font-mono text-xs uppercase tracking-[.24em] text-signal">
            {isRegister ? 'Create your channel' : 'Welcome back'}
          </p>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight">
            {isRegister ? 'Join Relay' : 'Sign in to Relay'}
          </h2>
          <p className="mt-2 text-mist">
            {isRegister
              ? 'Your conversations, synced and ready.'
              : 'Pick up exactly where you left off.'}
          </p>
          <form className="mt-9 space-y-5" onSubmit={submit}>
            {isRegister && (
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  label="Display name"
                  name="displayName"
                  autoComplete="name"
                  placeholder="Maya Chen"
                />
                <Field
                  label="Username"
                  name="username"
                  autoComplete="username"
                  placeholder="maya"
                />
              </div>
            )}
            <Field
              label="Email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
            />
            <Field
              label="Password"
              name="password"
              type="password"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              placeholder="••••••••••"
              hint={isRegister ? '10+ characters, upper/lowercase and a number' : undefined}
            />
            {error && (
              <div
                role="alert"
                className="border-l-2 border-flare bg-flare/10 px-4 py-3 text-sm text-[#ffad9a]"
              >
                {error}
              </div>
            )}
            <button
              disabled={busy}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-signal font-semibold text-ink transition hover:bg-[#68eadf] disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? (
                'Connecting…'
              ) : isRegister ? (
                <>
                  <Check size={18} /> Create account
                </>
              ) : (
                'Continue'
              )}
            </button>
          </form>
          <p className="mt-7 text-center text-sm text-mist">
            {isRegister ? 'Already on Relay?' : 'New to Relay?'}{' '}
            <Link
              className="font-semibold text-white underline decoration-white/30 underline-offset-4 hover:decoration-signal"
              to={isRegister ? '/login' : '/register'}
            >
              {isRegister ? 'Sign in' : 'Create an account'}
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}

function Field({
  label,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block text-sm font-medium text-[#d7e0e9]">
      {label}
      <input
        required
        className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-white/[0.035] px-4 text-base text-white outline-none transition placeholder:text-[#536274] focus:border-signal/70 focus:ring-4 focus:ring-signal/10"
        {...props}
      />
      {hint && <span className="mt-2 block text-xs font-normal text-mist">{hint}</span>}
    </label>
  );
}
