import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  CheckCheck,
  CornerUpLeft,
  Download,
  Info,
  LoaderCircle,
  Paperclip,
  Pencil,
  RotateCcw,
  Send,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { usePresence, useSocket } from '../contexts/SocketContext';
import { api } from '../lib/api';
import { conversationName, messageTime, relativeTime } from '../lib/format';
import type { Conversation, Message, Receipt } from '../types';
import { Avatar } from './Avatar';
import { ConversationDetails } from './ConversationDetails';

type PendingMessage = Message & { pending: true; failed?: boolean };
type SendAck =
  | { ok: true; clientMessageId: string; message: Message }
  | { ok: false; error: { code: string; message: string } };
type Upload = { fileName: string; mimeType: string; fileSize: number; storageKey: string };

export function ChatPanel({
  conversationId,
  onBack,
}: {
  conversationId: string;
  onBack: () => void;
}) {
  const { user } = useAuth();
  const socket = useSocket();
  const { connected, onlineUsers } = usePresence();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [liveMessages, setLiveMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map());
  const [reply, setReply] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [details, setDetails] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [uploading, setUploading] = useState(false);
  const [receiptUpdates, setReceiptUpdates] = useState<Map<string, Receipt[]>>(new Map());
  const [deleting, setDeleting] = useState<string | null>(null);
  const typingTimer = useRef<number>();
  const typingExpiry = useRef<Map<string, number>>(new Map());
  const listRef = useRef<HTMLDivElement>(null);
  const lastRead = useRef('');
  const lastTyping = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const messageLookup = useRef<Message[]>([]);
  const capabilities = useQuery({
    queryKey: ['capabilities'],
    queryFn: () => api<{ attachmentsEnabled: boolean }>('/api/config'),
  });

  const conversation = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => api<{ conversation: Conversation }>(`/api/conversations/${conversationId}`),
  });
  const history = useInfiniteQuery({
    queryKey: ['messages', conversationId],
    queryFn: ({ pageParam }) =>
      api<{ messages: Message[]; nextCursor: string | null }>(
        `/api/conversations/${conversationId}/messages?limit=50${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: '' as string,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: connected ? false : 5_000,
  });

  const markRead = useCallback(
    (message: Message) => {
      if (
        message.type === 'SYSTEM' ||
        document.visibilityState !== 'visible' ||
        lastRead.current === message.id
      )
        return;
      lastRead.current = message.id;
      const done = (result: { ok: boolean }) => {
        if (!result?.ok) lastRead.current = '';
        void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      };
      if (socket?.connected)
        socket.emit('message:read', { conversationId, messageId: message.id }, done);
      else
        void api(`/api/conversations/${conversationId}/read`, {
          method: 'POST',
          body: JSON.stringify({ messageId: message.id }),
        })
          .then(() => done({ ok: true }))
          .catch(() => done({ ok: false }));
    },
    [socket, conversationId, queryClient],
  );

  useEffect(() => {
    if (!socket) return;
    const onNew = (payload: { clientMessageId: string; message: Message }) => {
      if (payload.message.conversationId !== conversationId) {
        void queryClient.invalidateQueries({ queryKey: ['conversations'] });
        return;
      }
      setPending((items) =>
        items.filter((item) => item.clientMessageId !== payload.clientMessageId),
      );
      setLiveMessages((items) =>
        items.some((item) => item.id === payload.message.id) ? items : [...items, payload.message],
      );
    };
    const update = (message: Message) => {
      if (message.conversationId !== conversationId) return;
      setLiveMessages((items) =>
        items.some((item) => item.id === message.id)
          ? items.map((item) => (item.id === message.id ? message : item))
          : [...items, message],
      );
      void queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
    };
    const onTyping = (payload: { conversationId: string; userId: string; username: string }) => {
      if (payload.conversationId !== conversationId || payload.userId === user?.id) return;
      setTypingUsers((current) => new Map(current).set(payload.userId, payload.username));
      const old = typingExpiry.current.get(payload.userId);
      if (old) clearTimeout(old);
      typingExpiry.current.set(
        payload.userId,
        window.setTimeout(
          () =>
            setTypingUsers((current) => {
              const next = new Map(current);
              next.delete(payload.userId);
              return next;
            }),
          6_000,
        ),
      );
    };
    const stopTyping = (payload: { conversationId: string; userId: string }) => {
      if (payload.conversationId === conversationId)
        setTypingUsers((current) => {
          const next = new Map(current);
          next.delete(payload.userId);
          return next;
        });
    };
    const receipt = (payload: {
      messageId: string;
      userId: string;
      deliveredAt?: string;
      readAt?: string;
      conversationId?: string;
    }) => {
      if (payload.conversationId && payload.conversationId !== conversationId) return;
      const all = messageLookup.current;
      const target = all.find((message) => message.id === payload.messageId);
      const affected = all.filter(
        (message) =>
          message.id === payload.messageId ||
          (payload.readAt &&
            target &&
            (message.createdAt < target.createdAt ||
              (message.createdAt === target.createdAt && message.id <= target.id))),
      );
      setReceiptUpdates((prior) => {
        const next = new Map(prior);
        for (const message of affected)
          next.set(
            message.id,
            (next.get(message.id) ?? message.receipts).map((r) =>
              r.userId === payload.userId
                ? {
                    ...r,
                    deliveredAt: r.deliveredAt ?? payload.deliveredAt ?? payload.readAt ?? null,
                    readAt: payload.readAt ?? r.readAt,
                  }
                : r,
            ),
          );
        return next;
      });
    };
    socket.on('message:new', onNew);
    socket.on('message:edited', update);
    socket.on('message:deleted', update);
    socket.on('typing:start', onTyping);
    socket.on('typing:stop', stopTyping);
    socket.on('message:delivered', receipt);
    socket.on('message:read', receipt);
    return () => {
      socket.off('message:new', onNew);
      socket.off('message:edited', update);
      socket.off('message:deleted', update);
      socket.off('typing:start', onTyping);
      socket.off('typing:stop', stopTyping);
      socket.off('message:delivered', receipt);
      socket.off('message:read', receipt);
    };
  }, [socket, conversationId, user?.id, queryClient]);
  useEffect(() => {
    const timers = typingExpiry.current;
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(typingTimer.current);
      socket?.emit('typing:stop', { conversationId });
    };
  }, [socket, conversationId]);

  const stored = useMemo(() => {
    const pages = history.data?.pages ? [...history.data.pages].reverse() : [];
    const all = [...pages.flatMap((page) => page.messages), ...liveMessages];
    return [
      ...new Map(
        all.map((message) => [
          message.id,
          { ...message, receipts: receiptUpdates.get(message.id) ?? message.receipts },
        ]),
      ).values(),
    ].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }, [history.data?.pages, liveMessages, receiptUpdates]);
  messageLookup.current = stored;
  const messages = [...stored, ...pending];

  const newestMessage = stored.at(-1);
  useEffect(() => {
    const read = () => {
      if (newestMessage) markRead(newestMessage);
    };
    read();
    document.addEventListener('visibilitychange', read);
    return () => document.removeEventListener('visibilitychange', read);
  }, [newestMessage, markRead, connected]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [conversationId, history.isSuccess]);
  useEffect(() => {
    if (pending.length || liveMessages.length)
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [pending.length, liveMessages.length]);

  async function transmit(message: PendingMessage, attachments: Upload[] = []) {
    const input = {
      conversationId,
      clientMessageId: message.clientMessageId,
      content: message.content,
      type: message.type,
      replyToMessageId: message.replyToMessageId,
      attachments,
    };
    try {
      let response: SendAck;
      if (socket?.connected) {
        try {
          response = (await socket.timeout(5_000).emitWithAck('message:send', input)) as SendAck;
        } catch {
          response = {
            ok: true,
            ...(await api<{ clientMessageId: string; message: Message }>(
              `/api/conversations/${conversationId}/messages`,
              { method: 'POST', body: JSON.stringify(input) },
            )),
          };
        }
      } else
        response = {
          ok: true,
          ...(await api<{ clientMessageId: string; message: Message }>(
            `/api/conversations/${conversationId}/messages`,
            { method: 'POST', body: JSON.stringify(input) },
          )),
        };
      if (!response.ok) throw new Error(response.error.message);
      const saved = response.message;
      setPending((items) =>
        items.filter((item) => item.clientMessageId !== message.clientMessageId),
      );
      setLiveMessages((items) =>
        items.some((item) => item.id === saved.id) ? items : [...items, saved],
      );
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    } catch (error) {
      setPending((items) =>
        items.map((item) => (item.id === message.id ? { ...item, failed: true } : item)),
      );
      toast.error(
        error instanceof Error
          ? error.message
          : 'Message not confirmed. Retry to send the same ID.',
      );
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim() || uploads.map((file) => file.fileName).join(', ');
    if (!content || !user) return;
    if (editing) {
      try {
        const { message } = await api<{ message: Message }>(`/api/messages/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ content }),
        });
        setLiveMessages((items) => [...items.filter((item) => item.id !== message.id), message]);
        setEditing(null);
        setDraft('');
      } catch (error) {
        toast.error((error as Error).message);
      }
      return;
    }
    const clientMessageId = crypto.randomUUID();
    const optimistic: PendingMessage = {
      id: clientMessageId,
      clientMessageId,
      conversationId,
      senderId: user.id,
      sender: user,
      content,
      type: uploads.length ? 'FILE' : 'TEXT',
      replyToMessageId: reply?.id ?? null,
      replyTo: reply ? { id: reply.id, content: reply.content, sender: reply.sender } : null,
      receipts: [],
      attachments: uploads.map((file) => ({ ...file, id: file.storageKey })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      pending: true,
    };
    setDraft('');
    setReply(null);
    setUploads([]);
    setPending((items) => [...items, optimistic]);
    socket?.emit('typing:stop', { conversationId });
    await transmit(optimistic, uploads);
  }

  function draftChanged(value: string) {
    setDraft(value);
    if (!socket) return;
    if (Date.now() - lastTyping.current > 1_000) {
      socket.emit('typing:start', { conversationId });
      lastTyping.current = Date.now();
    }
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(
      () => socket.emit('typing:stop', { conversationId }),
      2_000,
    );
  }

  async function upload(file: File) {
    if (uploads.length >= 5) return toast.error('Maximum five files per message');
    setUploading(true);
    try {
      const metadata = { fileName: file.name, mimeType: file.type, fileSize: file.size };
      const signed = await api<{ uploadUrl: string; storageKey: string }>(
        '/api/attachments/presign',
        { method: 'POST', body: JSON.stringify(metadata) },
      );
      const result = await fetch(signed.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': file.type },
        body: file,
      });
      if (!result.ok) throw new Error('Upload failed');
      setUploads((items) => [...items, { ...metadata, storageKey: signed.storageKey }]);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function remove(message: Message) {
    if (deleting !== message.id) {
      setDeleting(message.id);
      return;
    }
    try {
      await api(`/api/messages/${message.id}`, { method: 'DELETE' });
      setDeleting(null);
      await history.refetch();
      setLiveMessages((items) => items.filter((item) => item.id !== message.id));
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  if (conversation.isLoading)
    return (
      <div className="grid flex-1 place-items-center bg-ink text-mist">
        <LoaderCircle className="animate-spin" />
      </div>
    );
  if (!user || !conversation.data)
    return (
      <div className="grid flex-1 place-items-center bg-ink p-8 text-center text-mist">
        This conversation is unavailable.
      </div>
    );
  const item = conversation.data.conversation;
  const other = item.members.find((member) => member.userId !== user.id)?.user;
  const online = other ? onlineUsers.has(other.id) : false;
  return (
    <section className="flex min-w-0 flex-1 flex-col bg-ink">
      <header className="flex h-[78px] items-center gap-3 border-b border-white/10 px-4 sm:px-6">
        <button
          onClick={onBack}
          className="grid h-10 w-10 place-items-center rounded-xl text-mist hover:bg-white/[0.05] md:hidden"
        >
          <ArrowLeft size={20} />
          <span className="sr-only">Back to conversations</span>
        </button>
        {other ? (
          <Avatar user={other} />
        ) : (
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.06] text-signal">
            <Users size={19} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display font-bold">{conversationName(item, user.id)}</h2>
          <p className={`mt-0.5 text-xs ${online ? 'text-signal' : 'text-mist'}`}>
            {item.type === 'GROUP'
              ? `${item.members.length} members`
              : online
                ? 'Online now'
                : `Last seen ${relativeTime(other?.lastSeenAt ?? null)}`}
          </p>
        </div>
        {!connected && (
          <span className="hidden text-xs text-flare sm:inline">Reconnecting · REST fallback</span>
        )}
        <button
          onClick={() => setDetails(true)}
          title="Conversation details"
          className="grid h-10 w-10 place-items-center rounded-xl text-mist hover:bg-white/[0.05] hover:text-white"
        >
          <Info size={19} />
          <span className="sr-only">Conversation details</span>
        </button>
      </header>
      <div
        ref={listRef}
        onScroll={(event) => {
          if (
            event.currentTarget.scrollTop < 80 &&
            history.hasNextPage &&
            !history.isFetchingNextPage
          ) {
            const element = event.currentTarget;
            const height = element.scrollHeight;
            const top = element.scrollTop;
            void history.fetchNextPage().then(() =>
              requestAnimationFrame(() => {
                element.scrollTop = top + element.scrollHeight - height;
              }),
            );
          }
        }}
        className="chat-scroll flex-1 overflow-y-auto px-4 py-6 sm:px-8"
      >
        <div className="mx-auto flex min-h-full max-w-4xl flex-col justify-end">
          {history.isFetchingNextPage && (
            <div className="mb-5 flex justify-center text-mist">
              <LoaderCircle className="animate-spin" size={18} />
            </div>
          )}
          {history.hasNextPage && (
            <button
              disabled={history.isFetchingNextPage}
              onClick={() => {
                const height = listRef.current?.scrollHeight ?? 0;
                void history.fetchNextPage().then(() =>
                  requestAnimationFrame(() => {
                    if (listRef.current)
                      listRef.current.scrollTop = listRef.current.scrollHeight - height;
                  }),
                );
              }}
              className="mx-auto mb-4 rounded-lg border border-white/10 px-4 py-2 text-xs text-mist"
            >
              Load older messages
            </button>
          )}
          {history.isError && (
            <p role="alert" className="my-5 text-center text-sm text-flare">
              Could not load history.{' '}
              <button
                onClick={() => {
                  void history.refetch();
                }}
                className="underline"
              >
                Retry
              </button>
            </p>
          )}
          {messages.map((message, index) => {
            const mine = message.senderId === user.id;
            const pendingMessage = 'pending' in message ? (message as PendingMessage) : null;
            const previous = messages[index - 1];
            const grouped =
              previous?.senderId === message.senderId &&
              new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() <
                5 * 60_000;
            if (message.type === 'SYSTEM')
              return (
                <div
                  key={message.id}
                  className="my-4 text-center font-mono text-[11px] uppercase tracking-[.14em] text-[#667688]"
                >
                  {message.content}
                </div>
              );
            return (
              <article
                key={message.id}
                className={`flex ${grouped ? 'mt-1.5' : 'mt-5'} gap-3 ${mine ? 'justify-end' : ''}`}
              >
                {!mine && !grouped && message.sender && <Avatar user={message.sender} size="sm" />}
                {!mine && grouped && <span className="w-8 shrink-0" />}
                <div
                  className={`max-w-[78%] sm:max-w-[68%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}
                >
                  {!grouped && !mine && (
                    <span className="mb-1.5 px-1 text-xs font-semibold text-[#cbd5df]">
                      {message.sender?.displayName ?? 'Former member'}
                    </span>
                  )}
                  {message.replyTo && (
                    <div className="mb-1 flex max-w-full items-center gap-2 border-l-2 border-signal/50 px-3 text-xs text-mist">
                      <CornerUpLeft size={12} />
                      <span className="truncate">{message.replyTo.content}</span>
                    </div>
                  )}
                  <div
                    className={`rounded-2xl px-4 py-2.5 text-[15px] leading-6 ${message.deletedAt ? 'border border-white/10 bg-transparent italic text-mist' : mine ? 'rounded-br-md bg-signal text-[#07100f]' : 'rounded-bl-md border border-white/[0.07] bg-[#151e29] text-[#e8eef4]'}`}
                  >
                    {message.deletedAt ? 'Message removed' : message.content}
                  </div>
                  {!pendingMessage &&
                    message.attachments.map((file) => (
                      <button
                        key={file.id}
                        onClick={() => {
                          void api<{ downloadUrl: string }>(`/api/attachments/${file.id}/url`)
                            .then(({ downloadUrl }) => {
                              const link = document.createElement('a');
                              link.href = downloadUrl;
                              link.rel = 'noopener noreferrer';
                              link.target = '_blank';
                              link.click();
                            })
                            .catch((error: Error) => toast.error(error.message));
                        }}
                        className="mt-1 flex max-w-full items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-signal"
                      >
                        <Download size={14} />
                        <span className="truncate">{file.fileName}</span>
                        <span className="text-xs text-mist">
                          {Math.ceil(file.fileSize / 1024)} KB
                        </span>
                      </button>
                    ))}
                  <div className="mt-1 flex items-center gap-1.5 px-1 font-mono text-[10px] text-[#657486]">
                    <time>{messageTime(message.createdAt)}</time>
                    {message.updatedAt !== message.createdAt && !message.deletedAt && (
                      <span>edited</span>
                    )}
                    {mine && <Status message={message} pending={pendingMessage} />}
                  </div>
                  {!message.deletedAt && !pendingMessage && (
                    <div className="mt-1 flex items-center gap-3 text-mist">
                      <button
                        aria-label={`Reply to message: ${message.content.slice(0, 30)}`}
                        title="Reply"
                        onClick={() => {
                          setReply(message);
                          setEditing(null);
                          document.getElementById('message-composer')?.focus();
                        }}
                        className="p-1 hover:text-signal"
                      >
                        <CornerUpLeft size={13} />
                      </button>
                      {mine && (
                        <>
                          <button
                            aria-label={`Edit message: ${message.content.slice(0, 30)}`}
                            title="Edit"
                            disabled={Date.now() - Date.parse(message.createdAt) > 15 * 60_000}
                            onClick={() => {
                              setEditing(message);
                              setDraft(message.content);
                              setReply(null);
                            }}
                            className="p-1 hover:text-signal disabled:opacity-30"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            aria-label={`Delete message: ${message.content.slice(0, 30)}`}
                            title="Delete"
                            onClick={() => {
                              void remove(message);
                            }}
                            className="p-1 hover:text-flare"
                          >
                            {deleting === message.id ? (
                              <span className="text-xs text-flare">Confirm delete</span>
                            ) : (
                              <Trash2 size={13} />
                            )}
                          </button>
                          {deleting === message.id && (
                            <button onClick={() => setDeleting(null)} className="text-xs">
                              Cancel
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                  {pendingMessage?.failed && (
                    <button
                      onClick={() => {
                        setPending((items) =>
                          items.map((m) => (m.id === message.id ? { ...m, failed: false } : m)),
                        );
                        void transmit(
                          pendingMessage,
                          pendingMessage.attachments.map((file) => ({
                            ...file,
                            storageKey: file.id,
                          })),
                        );
                      }}
                      className="mt-1 flex items-center gap-1 text-xs text-flare"
                    >
                      <RotateCcw size={12} />
                      Retry message
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
      <div className="h-6 px-5 text-xs text-signal">
        {typingUsers.size > 0
          ? `${[...typingUsers.values()].join(', ')} ${typingUsers.size > 1 ? 'are' : 'is'} typing…`
          : ''}
      </div>
      <form
        onSubmit={(event) => {
          void send(event);
        }}
        className="border-t border-white/10 p-3 sm:p-5"
      >
        {(reply || editing) && (
          <div className="mx-auto mb-2 flex max-w-4xl items-center gap-2 border-l-2 border-signal px-3 text-xs text-mist">
            <CornerUpLeft size={14} />
            <span className="min-w-0 flex-1 truncate">
              {editing ? 'Editing' : `Replying to ${reply?.sender?.displayName ?? 'message'}`} ·{' '}
              {(editing ?? reply)?.content}
            </span>
            <button
              type="button"
              aria-label="Cancel reply or edit"
              onClick={() => {
                if (editing) setDraft('');
                setEditing(null);
                setReply(null);
              }}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {uploads.length > 0 && (
          <div className="mx-auto mb-2 flex max-w-4xl flex-wrap gap-2">
            {uploads.map((file) => (
              <button
                type="button"
                key={file.storageKey}
                onClick={() =>
                  setUploads((items) => items.filter((item) => item.storageKey !== file.storageKey))
                }
                className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-signal"
              >
                {file.fileName}
                <X size={12} />
              </button>
            ))}
          </div>
        )}
        <div className="mx-auto flex max-w-4xl items-end gap-2 rounded-2xl border border-white/10 bg-[#111923] p-2 shadow-lg focus-within:border-signal/40 focus-within:ring-4 focus-within:ring-signal/[0.06]">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf,text/plain"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <button
            type="button"
            disabled={!capabilities.data?.attachmentsEnabled || uploading || Boolean(editing)}
            onClick={() => fileRef.current?.click()}
            title={
              capabilities.data?.attachmentsEnabled
                ? 'Attach a file'
                : 'Attachments require an S3 bucket'
            }
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-mist hover:bg-white/[0.05] hover:text-white disabled:opacity-30"
          >
            {uploading ? (
              <LoaderCircle size={19} className="animate-spin" />
            ) : (
              <Paperclip size={19} />
            )}
            <span className="sr-only">Attach a file</span>
          </button>
          <label className="sr-only" htmlFor="message-composer">
            Message
          </label>
          <textarea
            id="message-composer"
            rows={1}
            value={draft}
            onChange={(event) => draftChanged(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={`Message ${conversationName(item, user.id)}`}
            className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-1 py-2 text-base leading-6 outline-none placeholder:text-[#536274]"
          />
          <button
            disabled={(!draft.trim() && !uploads.length) || uploading}
            title={editing ? 'Save edit' : 'Send message'}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-signal text-ink transition hover:bg-[#68eadf] disabled:bg-white/[0.06] disabled:text-[#536274]"
          >
            <Send size={18} />
            <span className="sr-only">{editing ? 'Save edit' : 'Send message'}</span>
          </button>
        </div>
      </form>
      {details && <ConversationDetails conversation={item} onClose={() => setDetails(false)} />}
    </section>
  );
}

function Status({ message, pending }: { message: Message; pending: PendingMessage | null }) {
  if (pending?.failed) return <span className="font-sans font-semibold text-flare">Failed</span>;
  if (pending) return <span className="font-sans">Sending</span>;
  if (message.receipts.length && message.receipts.every((receipt) => receipt.readAt))
    return (
      <>
        <CheckCheck size={12} className="text-signal" />
        <span className="sr-only">Read</span>
      </>
    );
  if (message.receipts.length && message.receipts.every((receipt) => receipt.deliveredAt))
    return (
      <>
        <CheckCheck size={12} />
        <span className="sr-only">Delivered</span>
      </>
    );
  return (
    <>
      <Check size={12} />
      <span className="sr-only">Sent</span>
    </>
  );
}
