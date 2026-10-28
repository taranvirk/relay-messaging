import type { Server } from 'socket.io';

let io: Server | undefined;

export function setRealtimeServer(server: Server): void {
  io = server;
}

export function clearRealtimeServer(server: Server): void {
  if (io === server) io = undefined;
}

export function realtime(): Server | undefined {
  return io;
}

export const conversationRoom = (conversationId: string) => `conversation:${conversationId}`;
export const userRoom = (userId: string) => `user:${userId}`;
