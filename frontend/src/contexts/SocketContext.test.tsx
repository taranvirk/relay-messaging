import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SocketProvider, usePresence } from './SocketContext';

const transport = vi.hoisted(() => {
  const listeners = new Map<string, (payload?: unknown) => void>();
  return {
    listeners,
    socket: {
      on: vi.fn((event: string, listener: (payload?: unknown) => void) =>
        listeners.set(event, listener),
      ),
      off: vi.fn((event: string) => listeners.delete(event)),
      connect: vi.fn(),
      disconnect: vi.fn(),
      emit: vi.fn(),
    },
  };
});
vi.mock('socket.io-client', () => ({ io: () => transport.socket }));
vi.mock('./AuthContext', () => ({ useAuth: () => ({ user: { id: 'alice' } }) }));

beforeEach(() => {
  vi.clearAllMocks();
  transport.listeners.clear();
});
afterEach(() => vi.useRealTimers());

function Presence() {
  const { connected, onlineUsers } = usePresence();
  return (
    <p>
      {connected ? 'Connected' : 'Disconnected'}: {Array.from(onlineUsers).join(',')}
    </p>
  );
}

function mount() {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const view = render(
    <QueryClientProvider client={client}>
      <SocketProvider>
        <Presence />
      </SocketProvider>
    </QueryClientProvider>,
  );
  return { ...view, invalidate };
}

it('restores history on reconnect and clears stale presence on disconnect', () => {
  const { invalidate } = mount();
  act(() => {
    transport.listeners.get('connect')?.();
    transport.listeners.get('presence:snapshot')?.({ userIds: ['bob'] });
  });
  expect(screen.getByText('Connected: bob')).toBeTruthy();
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['messages'] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['conversations'] });
  act(() => transport.listeners.get('disconnect')?.());
  expect(screen.getByText('Disconnected:')).toBeTruthy();
});

it('retries a transient middleware rejection after Redis recovers', () => {
  vi.useFakeTimers();
  mount();
  act(() => transport.listeners.get('connect_error')?.({ data: { retryable: true } }));
  expect(transport.socket.connect).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(3000));
  expect(transport.socket.connect).toHaveBeenCalledTimes(2);
});

it('does not retry invalid authorization', () => {
  vi.useFakeTimers();
  mount();
  act(() => transport.listeners.get('connect_error')?.(new Error('unauthorized')));
  act(() => vi.advanceTimersByTime(10000));
  expect(transport.socket.connect).toHaveBeenCalledTimes(1);
});

it('cancels a scheduled retry when the signed-in layout unmounts', () => {
  vi.useFakeTimers();
  const view = mount();
  act(() => transport.listeners.get('connect_error')?.({ data: { retryable: true } }));
  view.unmount();
  act(() => vi.advanceTimersByTime(3000));
  expect(transport.socket.connect).toHaveBeenCalledTimes(1);
  expect(transport.socket.disconnect).toHaveBeenCalledTimes(1);
});
