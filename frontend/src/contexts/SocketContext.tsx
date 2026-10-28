import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Message } from '../types';
import { useAuth } from './AuthContext';

const SocketContext = createContext<Socket | null>(null);
const PresenceContext = createContext<{ connected: boolean; onlineUsers: Set<string> }>({
  connected: false,
  onlineUsers: new Set(),
});

export function SocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const socket = useMemo(
    () =>
      userId
        ? io(import.meta.env.VITE_API_URL ?? window.location.origin, {
            withCredentials: true,
            autoConnect: false,
            transports: ['websocket'],
            reconnection: true,
            reconnectionDelayMax: 5_000,
          })
        : null,
    [userId],
  );

  useEffect(() => {
    if (!socket) return;
    let retryTimer: number | undefined;
    const connect = () => {
      clearTimeout(retryTimer);
      retryTimer = undefined;
      setConnected(true);
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['messages'] });
    };
    const disconnect = (reason?: string) => {
      setConnected(false);
      setOnlineUsers(new Set());
      if (reason === 'io server disconnect')
        void queryClient.invalidateQueries({ queryKey: ['me'] });
    };
    const connectError = (error: Error & { data?: { retryable?: boolean } }) => {
      disconnect();
      if (error.message === 'unauthorized')
        void queryClient.invalidateQueries({ queryKey: ['me'] });
      if (error.data?.retryable && !retryTimer) {
        retryTimer = window.setTimeout(() => {
          retryTimer = undefined;
          socket.connect();
        }, 3000);
      }
    };
    const snapshot = ({ userIds }: { userIds: string[] }) => setOnlineUsers(new Set(userIds));
    const online = ({ userId: id }: { userId: string }) =>
      setOnlineUsers((current) => new Set(current).add(id));
    const offline = ({ userId: id }: { userId: string }) =>
      setOnlineUsers((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['conversation'] });
      void queryClient.invalidateQueries({ queryKey: ['messages'] });
    };
    const incoming = ({ message }: { message: Message }) => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      if (message.senderId === userId || message.type === 'SYSTEM') return;
      socket.emit('message:delivered', {
        conversationId: message.conversationId,
        messageId: message.id,
      });
      if (
        document.visibilityState === 'hidden' &&
        localStorage.getItem('relay:notifications') === 'on'
      ) {
        if ('Notification' in window && Notification.permission === 'granted')
          new Notification(message.sender?.displayName ?? 'Relay', {
            body: message.content.slice(0, 160),
            tag: message.id,
          });
      }
      if (!window.location.pathname.endsWith(message.conversationId))
        toast(message.sender?.displayName ?? 'New message', {
          description: message.content.slice(0, 100),
        });
      if (localStorage.getItem('relay:sounds') !== 'off' && 'AudioContext' in window) {
        try {
          const audio = new AudioContext();
          const oscillator = audio.createOscillator();
          const gain = audio.createGain();
          oscillator.connect(gain);
          gain.connect(audio.destination);
          gain.gain.setValueAtTime(0.025, audio.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.15);
          oscillator.frequency.value = 660;
          oscillator.start();
          oscillator.stop(audio.currentTime + 0.15);
          oscillator.onended = () => {
            void audio.close();
          };
        } catch {
          // Browser audio restrictions must not interrupt message processing.
        }
      }
    };
    socket.on('connect', connect);
    socket.on('disconnect', disconnect);
    socket.on('connect_error', connectError);
    socket.on('presence:snapshot', snapshot);
    socket.on('presence:online', online);
    socket.on('presence:offline', offline);
    socket.on('message:new', incoming);
    const events = [
      'conversation:created',
      'conversation:updated',
      'conversation:deleted',
      'member:removed',
    ];
    events.forEach((event) => socket.on(event, invalidate));
    socket.connect();
    return () => {
      clearTimeout(retryTimer);
      socket.off('connect', connect);
      socket.off('disconnect', disconnect);
      socket.off('connect_error', connectError);
      socket.off('presence:snapshot', snapshot);
      socket.off('presence:online', online);
      socket.off('presence:offline', offline);
      socket.off('message:new', incoming);
      events.forEach((event) => socket.off(event, invalidate));
      socket.disconnect();
    };
  }, [socket, queryClient, userId]);

  return (
    <SocketContext.Provider value={socket}>
      <PresenceContext.Provider value={{ connected, onlineUsers }}>
        {children}
      </PresenceContext.Provider>
    </SocketContext.Provider>
  );
}

export const useSocket = () => useContext(SocketContext);
export const usePresence = () => useContext(PresenceContext);
