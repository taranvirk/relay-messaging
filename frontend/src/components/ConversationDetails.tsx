import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { conversationName } from '../lib/format';
import type { Conversation, User } from '../types';
import { Avatar } from './Avatar';

export function ConversationDetails({
  conversation,
  onClose,
}: {
  conversation: Conversation;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [name, setName] = useState(conversation.name ?? '');
  const [search, setSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const role = conversation.members.find((member) => member.userId === user?.id)?.role;
  const manager = role === 'OWNER' || role === 'ADMIN';
  const users = useQuery({
    queryKey: ['user-search', search],
    queryFn: () => api<{ users: User[] }>(`/api/users/search?q=${encodeURIComponent(search)}`),
    enabled: search.trim().length >= 2 && manager,
    staleTime: 30_000,
  });
  const change = useMutation({
    mutationFn: ({
      path,
      method,
      body,
    }: {
      path: string;
      method: string;
      body?: unknown;
      leave?: boolean;
    }) =>
      api(`/api/conversations/${conversation.id}${path}`, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    onSuccess: (_result, input) => {
      void client.invalidateQueries({ queryKey: ['conversation', conversation.id] });
      void client.invalidateQueries({ queryKey: ['conversations'] });
      void client.invalidateQueries({ queryKey: ['messages', conversation.id] });
      if (input.leave) {
        onClose();
        navigate('/messages');
      }
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="details-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl border border-white/10 bg-panel p-6 text-white shadow-signal">
        <header className="flex items-center justify-between">
          <h2 id="details-title" className="font-display text-xl font-bold">
            {conversationName(conversation, user?.id ?? '')}
          </h2>
          <button
            aria-label="Close conversation details"
            onClick={onClose}
            className="p-2 text-mist"
          >
            <X size={20} />
          </button>
        </header>
        {conversation.type === 'GROUP' && manager && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              change.mutate({ path: '', method: 'PATCH', body: { name } });
            }}
            className="mt-6 flex gap-2"
          >
            <label className="flex-1 text-xs text-mist">
              Group name
              <input
                value={name}
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
                className="mt-2 h-10 w-full rounded-lg border border-white/10 bg-ink px-3 text-white"
              />
            </label>
            <button
              disabled={change.isPending || !name.trim()}
              className="mt-6 rounded-lg bg-signal px-4 text-sm font-semibold text-ink"
            >
              Save
            </button>
          </form>
        )}
        <h3 className="mb-3 mt-6 text-xs uppercase tracking-widest text-mist">
          Members · {conversation.members.length}
        </h3>
        <div className="space-y-3">
          {conversation.members.map((member) => (
            <div key={member.userId} className="flex items-center gap-3">
              <Avatar user={member.user} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {member.user.displayName}
                  {member.userId === user?.id ? ' (you)' : ''}
                </p>
                <p className="text-xs text-mist">
                  @{member.user.username} · {member.role.toLowerCase()}
                </p>
              </div>
              {role === 'OWNER' && member.userId !== user?.id && (
                <button
                  disabled={change.isPending}
                  onClick={() =>
                    change.mutate({
                      path: '/owner',
                      method: 'POST',
                      body: { userId: member.userId },
                    })
                  }
                  className="text-xs text-signal"
                >
                  Make owner
                </button>
              )}
              {manager &&
                member.userId !== user?.id &&
                member.role !== 'OWNER' &&
                (member.role !== 'ADMIN' || role === 'OWNER') && (
                  <button
                    disabled={change.isPending}
                    onClick={() =>
                      change.mutate({ path: `/members/${member.userId}`, method: 'DELETE' })
                    }
                    className="text-xs text-flare"
                  >
                    Remove
                  </button>
                )}
            </div>
          ))}
        </div>
        {conversation.type === 'GROUP' && manager && (
          <div className="mt-6">
            <label className="relative block">
              <Search className="absolute left-3 top-3 text-mist" size={16} />
              <input
                aria-label="Search members to add"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Find someone to add"
                className="h-10 w-full rounded-lg border border-white/10 bg-ink pl-9 pr-3 text-sm"
              />
            </label>
            {users.data?.users
              .filter((candidate) => !conversation.members.some((m) => m.userId === candidate.id))
              .map((candidate) => (
                <button
                  key={candidate.id}
                  disabled={change.isPending}
                  onClick={() => {
                    change.mutate({
                      path: '/members',
                      method: 'POST',
                      body: { userId: candidate.id },
                    });
                    setSearch('');
                  }}
                  className="mt-2 flex w-full justify-between rounded-lg bg-white/5 p-3 text-sm"
                >
                  <span>{candidate.displayName}</span>
                  <span className="text-signal">Add</span>
                </button>
              ))}
          </div>
        )}
        {conversation.type === 'GROUP' && (
          <div className="mt-6 border-t border-white/10 pt-5">
            <button
              disabled={role === 'OWNER' || change.isPending}
              onClick={() =>
                change.mutate({ path: `/members/${user?.id}`, method: 'DELETE', leave: true })
              }
              className="text-sm text-flare disabled:text-mist"
            >
              Leave group
            </button>
            {role === 'OWNER' && (
              <p className="mt-2 text-xs text-mist">
                Make another member the owner before leaving, or delete this group.
              </p>
            )}
          </div>
        )}
        {(conversation.type === 'DIRECT' || role === 'OWNER') && (
          <div className="mt-4">
            <button
              disabled={change.isPending}
              onClick={() => {
                if (confirmDelete) change.mutate({ path: '', method: 'DELETE', leave: true });
                else setConfirmDelete(true);
              }}
              className="text-sm text-flare"
            >
              {confirmDelete ? 'Confirm delete for everyone' : 'Delete conversation for everyone'}
            </button>
            {confirmDelete && (
              <button onClick={() => setConfirmDelete(false)} className="ml-4 text-sm text-mist">
                Cancel
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
