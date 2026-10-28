import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from './ChatPanel';
import { ConversationList } from './ConversationList';

const realtime = vi.hoisted(() => ({
  enabled: false,
  listeners: new Map<string, Set<(payload: unknown) => void>>(),
}));
const socketAck = vi.fn();
const mockSocket = {
  connected: true,
  on: vi.fn((event: string, listener: (payload: unknown) => void) => {
    const listeners = realtime.listeners.get(event) ?? new Set();
    listeners.add(listener);
    realtime.listeners.set(event, listeners);
  }),
  off: vi.fn((event: string, listener: (payload: unknown) => void) => {
    realtime.listeners.get(event)?.delete(listener);
  }),
  emit: vi.fn(),
  timeout: vi.fn(() => ({ emitWithAck: socketAck })),
};

const alice = {
  id: 'alice',
  username: 'alice',
  displayName: 'Alice',
  avatarUrl: null,
  lastSeenAt: null,
  createdAt: '2026-10-05T10:00:00Z',
};
const bob = { ...alice, id: 'bob', username: 'bob', displayName: 'Bob' };
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: alice }) }));
vi.mock('../contexts/SocketContext', () => ({
  useSocket: () => (realtime.enabled ? mockSocket : null),
  usePresence: () => ({ connected: realtime.enabled, onlineUsers: new Set(['bob']) }),
}));
const saved = {
  id: 'message-1',
  clientMessageId: 'original',
  conversationId: 'conversation-1',
  senderId: 'bob',
  sender: bob,
  content: 'Hello Alice',
  type: 'TEXT',
  replyToMessageId: null,
  replyTo: null,
  receipts: [],
  attachments: [],
  createdAt: '2026-10-05T10:00:00Z',
  updatedAt: '2026-10-05T10:00:00Z',
  deletedAt: null,
};
const conversation = {
  id: 'conversation-1',
  type: 'DIRECT',
  name: null,
  unreadCount: 0,
  members: [
    { userId: 'alice', user: alice, role: 'MEMBER' },
    { userId: 'bob', user: bob, role: 'MEMBER' },
  ],
  messages: [saved],
};

beforeEach(() => {
  vi.clearAllMocks();
  socketAck.mockReset();
  realtime.enabled = false;
  realtime.listeners.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      let body: unknown;
      if (input.endsWith('/api/config')) body = { attachmentsEnabled: false };
      else if (input.includes('/messages?')) body = { messages: [saved], nextCursor: null };
      else if (input.endsWith('/messages') && init?.method === 'POST')
        body = {
          message: {
            ...saved,
            ...JSON.parse(String(init.body)),
            id: 'sent-1',
            senderId: alice.id,
            sender: alice,
          },
          clientMessageId: JSON.parse(String(init.body)).clientMessageId,
        };
      else if (input.endsWith('/read')) body = { receipt: {} };
      else body = { conversation };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  HTMLElement.prototype.scrollTo = vi.fn();
});

afterEach(() => vi.unstubAllGlobals());

function emitIncoming(event: string, payload: unknown) {
  for (const listener of realtime.listeners.get(event) ?? []) listener(payload);
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ChatPanel conversationId="conversation-1" onBack={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('chat controls', () => {
  it('replies using the REST fallback and reconciles the acknowledgement', async () => {
    mount();
    await screen.findByText('Hello Alice');
    fireEvent.click(screen.getByRole('button', { name: /Reply to message/ }));
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Reply through REST' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText('Reply through REST');
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/conversations/conversation-1/messages',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"replyToMessageId":"message-1"'),
        }),
      ),
    );
    await waitFor(() => expect(screen.queryByText('Sending')).toBeNull());
  });

  it('shows live presence and working conversation details', async () => {
    mount();
    await screen.findByText('Online now');
    fireEvent.click(screen.getByRole('button', { name: 'Conversation details' }));
    expect(document.body.contains(screen.getByRole('dialog'))).toBe(true);
    expect(document.body.contains(screen.getByText('Alice (you)'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close conversation details' }));
    await act(async () => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('deduplicates incoming messages and updates typing state', async () => {
    realtime.enabled = true;
    mount();
    await screen.findByText('Hello Alice');
    const payload = {
      clientMessageId: 'incoming-2',
      message: { ...saved, id: 'incoming-2', content: 'Arrived live' },
    };
    act(() => {
      emitIncoming('message:new', payload);
      emitIncoming('message:new', payload);
      emitIncoming('typing:start', {
        conversationId: conversation.id,
        userId: bob.id,
        username: 'bob',
      });
    });
    expect(screen.getAllByText('Arrived live')).toHaveLength(1);
    expect(document.body.contains(screen.getByText('bob is typing…'))).toBe(true);
    act(() => emitIncoming('typing:stop', { conversationId: conversation.id, userId: bob.id }));
    expect(screen.queryByText('bob is typing…')).toBeNull();
  });

  it('retries a failed send with the same idempotency key', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation()!;
    const sent: string[] = [];
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith('/messages') && init?.method === 'POST') {
        const payload = JSON.parse(String(init.body));
        sent.push(payload.clientMessageId);
        if (sent.length === 1)
          return new Response(
            JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Try again' } }),
            { status: 503 },
          );
      }
      return originalFetch(input, init);
    });
    mount();
    await screen.findByText('Hello Alice');
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Retry safely' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText('Failed');
    fireEvent.click(screen.getByRole('button', { name: 'Retry message' }));
    await waitFor(() => expect(screen.queryByText('Failed')).toBeNull());
    expect(sent).toHaveLength(2);
    expect(sent[1]).toBe(sent[0]);
    expect(screen.getAllByText('Retry safely')).toHaveLength(1);
  });

  it('falls back after a socket acknowledgement timeout without changing the client ID', async () => {
    realtime.enabled = true;
    socketAck.mockRejectedValue(new Error('timeout'));
    mount();
    await screen.findByText('Hello Alice');
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Socket fallback' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(screen.queryByText('Sending')).toBeNull());
    expect(socketAck).toHaveBeenCalledTimes(1);
    const socketPayload = socketAck.mock.calls[0]![1];
    expect(fetch).toHaveBeenCalledWith(
      '/api/conversations/conversation-1/messages',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining(socketPayload.clientMessageId),
      }),
    );
  });

  it('loads older cursor history in deterministic order', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).includes('/messages?')) {
        const older = String(input).includes('cursor=message-1');
        return new Response(
          JSON.stringify({
            messages: older
              ? [
                  {
                    ...saved,
                    id: 'older-1',
                    content: 'Older history',
                    createdAt: '2026-10-04T10:00:00Z',
                  },
                ]
              : [saved],
            nextCursor: older ? null : 'message-1',
          }),
        );
      }
      return originalFetch(input, init);
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Load older messages' }));
    const older = await screen.findByText('Older history');
    const latest = screen.getByText('Hello Alice');
    expect(older.compareDocumentPosition(latest) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load older messages' })).toBeNull();
  });

  it('renders conversation previews and unread badges', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ conversations: [{ ...conversation, unreadCount: 3 }] })),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ConversationList mobileHidden={false} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText('Hello Alice');
    expect(document.body.contains(screen.getByText('3'))).toBe(true);
    fireEvent.change(screen.getByLabelText('Filter conversations'), {
      target: { value: 'nobody' },
    });
    expect(screen.queryByText('Hello Alice')).toBeNull();
  });
});
