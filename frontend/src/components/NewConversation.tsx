import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Search, Users, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { Conversation, User } from '../types';
import { Avatar } from './Avatar';
import { toast } from 'sonner';

export function NewConversation({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<'DIRECT' | 'GROUP'>('DIRECT');
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<User[]>([]);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const users = useQuery({
    queryKey: ['user-search', query],
    queryFn: () => api<{ users: User[] }>(`/api/users/search?q=${encodeURIComponent(query)}`),
    enabled: open && query.trim().length >= 2,
    staleTime: 30_000,
  });
  const create = useMutation({
    mutationFn: () =>
      api<{ conversation: Conversation }>('/api/conversations', {
        method: 'POST',
        body: JSON.stringify(
          mode === 'DIRECT'
            ? { type: 'DIRECT', memberIds: [selected[0]!.id] }
            : { type: 'GROUP', name, memberIds: selected.map((user) => user.id) },
        ),
      }),
    onError: (error) => toast.error(error.message),
    onSuccess: ({ conversation }) => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      navigate(`/messages/${conversation.id}`);
      close();
    },
  });
  if (!open) return null;

  function close() {
    setSelected([]);
    setName('');
    setQuery('');
    onClose();
  }
  function toggle(user: User) {
    if (mode === 'DIRECT') setSelected([user]);
    else
      setSelected((current) =>
        current.some((item) => item.id === user.id)
          ? current.filter((item) => item.id !== user.id)
          : [...current, user],
      );
  }

  const canCreate = selected.length > 0 && (mode === 'DIRECT' || name.trim().length > 0);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-conversation-title"
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) close();
      }}
    >
      <section className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-[#111923] shadow-signal">
        <header className="flex items-center justify-between border-b border-white/10 p-5">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[.2em] text-signal">
              Open a channel
            </p>
            <h2 id="new-conversation-title" className="mt-1 font-display text-xl font-bold">
              New conversation
            </h2>
          </div>
          <button
            onClick={close}
            className="grid h-10 w-10 place-items-center rounded-xl text-mist hover:bg-white/[0.06] hover:text-white"
          >
            <X size={19} />
            <span className="sr-only">Close</span>
          </button>
        </header>
        <div className="p-5">
          <div className="grid grid-cols-2 rounded-xl bg-black/20 p-1 text-sm">
            {(['DIRECT', 'GROUP'] as const).map((value) => (
              <button
                key={value}
                onClick={() => {
                  setMode(value);
                  setSelected([]);
                }}
                className={`h-10 rounded-lg font-medium transition ${mode === value ? 'bg-white/10 text-white' : 'text-mist hover:text-white'}`}
              >
                {value === 'DIRECT' ? 'Direct message' : 'Group'}
              </button>
            ))}
          </div>
          {mode === 'GROUP' && (
            <label className="mt-5 block text-sm font-medium text-[#d7e0e9]">
              Group name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={100}
                placeholder="Platform crew"
                className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-white/[0.035] px-4 outline-none focus:border-signal/70"
              />
            </label>
          )}
          {selected.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {selected.map((user) => (
                <button
                  key={user.id}
                  onClick={() => toggle(user)}
                  className="flex items-center gap-2 rounded-lg border border-signal/20 bg-signal/10 px-2.5 py-1.5 text-sm text-signal"
                >
                  {user.displayName}
                  <X size={14} />
                </button>
              ))}
            </div>
          )}
          <label className="relative mt-5 block">
            <Search className="absolute left-3 top-3 text-mist" size={18} />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name or username"
              className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.035] pl-10 pr-4 outline-none focus:border-signal/70"
            />
          </label>
          <div className="mt-3 max-h-56 space-y-1 overflow-auto">
            {users.isFetching && <p className="p-4 text-sm text-mist">Searching…</p>}
            {!users.isFetching && query.length >= 2 && users.data?.users.length === 0 && (
              <p className="p-4 text-sm text-mist">No people found.</p>
            )}
            {users.data?.users.map((user) => {
              const active = selected.some((item) => item.id === user.id);
              return (
                <button
                  key={user.id}
                  onClick={() => toggle(user)}
                  className="flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-white/[0.05]"
                >
                  <Avatar user={user} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{user.displayName}</span>
                    <span className="block truncate text-xs text-mist">@{user.username}</span>
                  </span>
                  {active && <Check className="text-signal" size={18} />}
                </button>
              );
            })}
          </div>
        </div>
        <footer className="flex items-center justify-between border-t border-white/10 p-5">
          <span className="flex items-center gap-2 text-xs text-mist">
            <Users size={15} /> {selected.length} selected
          </span>
          <button
            disabled={!canCreate || create.isPending}
            onClick={() => create.mutate()}
            className="h-10 rounded-xl bg-signal px-5 text-sm font-semibold text-ink disabled:opacity-40"
          >
            {create.isPending ? 'Creating…' : 'Start conversation'}
          </button>
        </footer>
      </section>
    </div>
  );
}
