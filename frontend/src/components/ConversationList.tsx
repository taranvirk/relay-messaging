import { useState } from 'react';
import { Archive, Plus, Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { conversationName, messageTime } from '../lib/format';
import type { Conversation } from '../types';
import { Avatar } from './Avatar';
import { NewConversation } from './NewConversation';
import { usePresence } from '../contexts/SocketContext';

export function ConversationList({ mobileHidden }: { mobileHidden: boolean }) {
  const { user } = useAuth();
  const { connected } = usePresence();
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const conversations = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api<{ conversations: Conversation[] }>('/api/conversations'),
    refetchOnWindowFocus: true,
    refetchInterval: connected ? false : 10_000,
  });
  if (!user) return null;
  const visible =
    conversations.data?.conversations.filter((item) =>
      conversationName(item, user.id).toLowerCase().includes(filter.toLowerCase()),
    ) ?? [];

  return (
    <>
      <section
        className={`${mobileHidden ? 'hidden' : 'flex'} w-full flex-col border-r border-white/10 bg-[#0e151e] md:flex md:w-[340px] xl:w-[380px]`}
      >
        <header className="border-b border-white/10 px-5 pb-4 pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[.2em] text-signal">
                Live inbox
              </p>
              <h1 className="mt-1 font-display text-2xl font-bold">Messages</h1>
            </div>
            <button
              onClick={() => setCreating(true)}
              title="New conversation"
              className="grid h-10 w-10 place-items-center rounded-xl bg-signal text-ink transition hover:bg-[#68eadf]"
            >
              <Plus size={20} />
              <span className="sr-only">New conversation</span>
            </button>
          </div>
          <label className="relative mt-5 block">
            <Search className="absolute left-3 top-2.5 text-mist" size={17} />
            <span className="sr-only">Filter conversations</span>
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter conversations"
              className="h-10 w-full rounded-xl border border-white/10 bg-black/20 pl-9 pr-3 text-sm outline-none placeholder:text-[#596777] focus:border-signal/50"
            />
          </label>
        </header>
        <div className="flex-1 overflow-y-auto p-3">
          {conversations.isLoading &&
            [...Array(5)].map((_, index) => (
              <div
                key={index}
                className="mb-2 h-[72px] animate-pulse rounded-xl bg-white/[0.035]"
              />
            ))}
          {conversations.isError && (
            <div className="m-2 border-l-2 border-flare bg-flare/10 p-4 text-sm text-[#ffad9a]">
              Conversations are unavailable. Retrying shortly.
            </div>
          )}
          {!conversations.isLoading && visible.length === 0 && (
            <div className="grid place-items-center px-6 py-16 text-center">
              <Archive className="text-[#3d4b5b]" size={28} />
              <p className="mt-3 font-medium">No conversations here</p>
              <p className="mt-1 text-sm text-mist">Start one with the + button.</p>
            </div>
          )}
          {visible.map((conversation) => {
            const other =
              conversation.members.find((member) => member.userId !== user.id)?.user ?? user;
            const last = conversation.messages[0];
            return (
              <NavLink
                key={conversation.id}
                to={`/messages/${conversation.id}`}
                className={({ isActive }) =>
                  `mb-1 flex items-center gap-3 rounded-xl border p-3 transition ${isActive ? 'border-signal/20 bg-signal/[0.08]' : 'border-transparent hover:bg-white/[0.035]'}`
                }
              >
                <Avatar user={other} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <strong className="truncate text-sm font-semibold">
                      {conversationName(conversation, user.id)}
                    </strong>
                    {last && (
                      <time className="shrink-0 font-mono text-[10px] text-mist">
                        {messageTime(last.createdAt)}
                      </time>
                    )}
                  </span>
                  <span className="mt-1 flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-mist">
                      {last?.deletedAt ? 'Message removed' : (last?.content ?? 'No messages yet')}
                    </span>
                    {conversation.unreadCount > 0 && (
                      <span className="grid min-w-5 place-items-center rounded-md bg-flare px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {conversation.unreadCount}
                      </span>
                    )}
                  </span>
                </span>
              </NavLink>
            );
          })}
        </div>
      </section>
      <NewConversation open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
