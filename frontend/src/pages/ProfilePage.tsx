import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, Check } from 'lucide-react';
import { toast } from 'sonner';
import { AppNav } from '../components/AppNav';
import { Avatar } from '../components/Avatar';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import type { User } from '../types';

export function ProfilePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const mutation = useMutation({
    mutationFn: (input: { displayName: string; username: string; avatarUrl: string | null }) =>
      api<{ user: User }>('/api/users/me', { method: 'PATCH', body: JSON.stringify(input) }),
    onSuccess: (data) => {
      queryClient.setQueryData(['me'], data);
      setSaved(true);
      toast.success('Profile updated');
    },
  });
  if (!user) return null;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const data = new FormData(event.currentTarget);
    mutation.mutate({
      displayName: String(data.get('displayName')),
      username: String(data.get('username')),
      avatarUrl: String(data.get('avatarUrl')) || null,
    });
  }
  return (
    <main className="flex min-h-screen bg-ink text-white">
      <AppNav />
      <section className="w-full pt-16 lg:pt-0">
        <div className="mx-auto max-w-3xl px-6 py-10 sm:py-16">
          <p className="font-mono text-xs uppercase tracking-[.22em] text-signal">Account</p>
          <h1 className="mt-2 font-display text-3xl font-bold">Your profile</h1>
          <p className="mt-2 text-mist">How people recognize you across Relay.</p>
          <div className="mt-10 grid gap-8 rounded-2xl border border-white/10 bg-panel p-6 shadow-signal sm:grid-cols-[160px_1fr] sm:p-8">
            <div>
              <div className="relative inline-block">
                <Avatar user={user} size="lg" />
                <span className="absolute -bottom-2 -right-2 grid h-8 w-8 place-items-center rounded-lg border-4 border-panel bg-signal text-ink">
                  <Camera size={14} />
                </span>
              </div>
              <p className="mt-5 text-xs leading-5 text-mist">
                Use a secure HTTPS image URL or leave it empty for initials.
              </p>
            </div>
            <form onSubmit={submit} className="space-y-5">
              <ProfileField
                label="Display name"
                name="displayName"
                defaultValue={user.displayName}
              />
              <ProfileField label="Username" name="username" defaultValue={user.username} />
              <ProfileField
                label="Avatar URL"
                name="avatarUrl"
                type="url"
                defaultValue={user.avatarUrl ?? ''}
                placeholder="https://…"
              />
              <label className="block text-sm text-mist">
                Email
                <input
                  disabled
                  value={user.email ?? ''}
                  className="mt-2 h-11 w-full rounded-xl border border-white/[0.06] bg-black/20 px-4 text-[#69798a]"
                />
              </label>
              <button
                disabled={mutation.isPending}
                className="flex h-11 items-center gap-2 rounded-xl bg-signal px-5 font-semibold text-ink disabled:opacity-50"
              >
                <Check size={17} />
                {mutation.isPending ? 'Saving…' : saved ? 'Saved' : 'Save changes'}
              </button>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}

function ProfileField(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, ...input } = props;
  return (
    <label className="block text-sm font-medium text-[#d7e0e9]">
      {label}
      <input
        {...input}
        required={input.name !== 'avatarUrl'}
        className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-white/[0.035] px-4 outline-none focus:border-signal/70"
      />
    </label>
  );
}
