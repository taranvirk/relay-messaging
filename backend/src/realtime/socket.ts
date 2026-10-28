import type { Server as HttpServer } from 'node:http';
import { parse } from 'cookie';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { prisma } from '../config/prisma.js';
import { SESSION_COOKIE } from '../middleware/auth.js';
import { emitMetric } from '../observability/metrics.js';
import { requireMember } from '../services/conversation.service.js';
import {
  createMessage,
  deleteMessage,
  editMessage,
  markDelivered,
  markRead,
} from '../services/message.service.js';
import { assertSession, verifyToken, type TokenPayload } from '../utils/auth.js';
import { consumeLimit } from '../middleware/rate-limit.js';
import { AppError } from '../utils/errors.js';
import {
  receiptSchema,
  socketDeleteMessageSchema,
  socketEditMessageSchema,
  socketMessageSchema,
  typingSchema,
} from '../validators/messages.js';
import { clearRealtimeServer, conversationRoom, setRealtimeServer, userRoom } from './emitter.js';
import {
  connectPresence,
  disconnectPresence,
  onlineUsers,
  sweepPresence,
  refreshTyping,
  stopTyping,
} from './presence.js';

type Ack = (
  result:
    { ok: true; [key: string]: unknown } | { ok: false; error: { code: string; message: string } },
) => void;
let activeConnections = 0;
const cleanup = new WeakMap<Server, () => Promise<void>>();
const closing = new WeakSet<Server>();

export async function closeRealtimeServer(io: Server): Promise<void> {
  closing.add(io);
  clearRealtimeServer(io);
  await new Promise<void>((resolve) => io.close(() => resolve()));
  await cleanup.get(io)?.();
}

function socketError(error: unknown) {
  if (error instanceof AppError) return { code: error.code, message: error.message };
  return { code: 'INVALID_EVENT', message: 'The event could not be processed' };
}

export async function createRealtimeServer(
  httpServer: HttpServer,
  connectAdapter = true,
): Promise<Server> {
  const io = new Server(httpServer, {
    cors: {
      origin: env.FRONTEND_ORIGIN.split(',').map((value) => value.trim()),
      credentials: true,
    },
    // One WebSocket per session needs no sticky load-balancer affinity.
    transports: ['websocket'],
    allowRequest: (request, callback) =>
      callback(
        null,
        !request.headers.origin ||
          env.FRONTEND_ORIGIN.split(',')
            .map((value) => value.trim())
            .includes(request.headers.origin),
      ),
    pingTimeout: 20_000,
    pingInterval: 25_000,
  });

  let closeAdapter = async () => {};
  if (connectAdapter) {
    try {
      const publisher = createClient({
        url: env.REDIS_URL,
        socket: {
          connectTimeout: 3_000,
          reconnectStrategy: (attempt) => Math.min(200 * 2 ** attempt, 3_000),
        },
      });
      const subscriber = publisher.duplicate();
      publisher.on('error', (error) =>
        logger.error({ err: error }, 'Socket Redis publisher error'),
      );
      subscriber.on('error', (error) =>
        logger.error({ err: error }, 'Socket Redis subscriber error'),
      );
      await Promise.all([publisher.connect(), subscriber.connect()]);
      io.adapter(createAdapter(publisher, subscriber));
      closeAdapter = async () => {
        await Promise.allSettled([publisher.quit(), subscriber.quit()]);
      };
      logger.info('Socket.IO Redis adapter connected');
    } catch (error) {
      if (env.NODE_ENV === 'production') throw error;
      logger.warn({ err: error }, 'Socket.IO running without Redis adapter');
    }
  }

  const emitPresence = async (userId: string, online: boolean) => {
    if (closing.has(io)) return;
    const members = await prisma.conversationMember.findMany({
      where: { userId },
      select: { conversationId: true },
    });
    if (closing.has(io)) return;
    io.to(members.map(({ conversationId }) => conversationRoom(conversationId))).emit(
      online ? 'presence:online' : 'presence:offline',
      { userId, ...(!online ? { lastSeenAt: new Date() } : {}) },
    );
  };
  const sweeper = setInterval(() => {
    void sweepPresence()
      .then((ids) => Promise.all(ids.map((id) => emitPresence(id, false))))
      .catch((error) => logger.warn({ err: error }, 'Presence sweep failed'));
  }, 15_000);
  sweeper.unref();
  cleanup.set(io, async () => {
    clearInterval(sweeper);
    await closeAdapter();
  });

  io.use((socket, next) => {
    void (async () => {
      try {
        const cookies = parse(socket.handshake.headers.cookie ?? '');
        const authToken =
          typeof socket.handshake.auth.token === 'string' ? socket.handshake.auth.token : undefined;
        const payload = verifyToken(authToken ?? cookies[SESSION_COOKIE] ?? '');
        await assertSession(payload);
        const account = await prisma.user.findUnique({
          where: { id: payload.sub },
          select: { username: true },
        });
        if (!account) throw new Error('Account not found');
        const memberships = await prisma.conversationMember.findMany({
          where: { userId: payload.sub },
          select: { conversationId: true },
        });
        await socket.join([
          userRoom(payload.sub),
          `session:${payload.jti}`,
          ...memberships.map(({ conversationId }) => conversationRoom(conversationId)),
        ]);
        socket.data.becameOnline = await connectPresence(payload.sub, socket.id);
        socket.data.session = payload;
        socket.data.user = { id: payload.sub, username: account.username };
        next();
      } catch (error) {
        if (error instanceof AppError && error.status === 503) {
          const unavailable: Error & { data?: { retryable: boolean } } = new Error(
            'temporarily unavailable',
          );
          unavailable.data = { retryable: true };
          next(unavailable);
        } else next(new Error('unauthorized'));
      }
    })();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as { id: string; username: string };
    const session = socket.data.session as TokenPayload;
    activeConnections += 1;
    emitMetric('WebSocketConnections', activeConnections);
    const expiration = setTimeout(
      () => socket.disconnect(true),
      Math.min(2_147_483_647, session.exp * 1000 - Date.now()),
    );
    expiration.unref();
    socket.use((_packet, next) => {
      void assertSession(session)
        .then(() => next())
        .catch((error: unknown) => {
          // A transport close permits automatic recovery; a revoked/expired
          // session is deliberately disconnected without retrying authorization.
          if (error instanceof AppError && error.status === 503) socket.conn.close();
          else socket.disconnect(true);
        });
    });
    void (async () => {
      try {
        if (socket.data.becameOnline) await emitPresence(user.id, true);
        const peers = await prisma.conversationMember.findMany({
          where: { conversation: { members: { some: { userId: user.id } } } },
          select: { userId: true },
          distinct: ['userId'],
        });
        socket.emit('presence:snapshot', {
          userIds: await onlineUsers(peers.map(({ userId }) => userId)),
        });
        logger.info(
          { userId: user.id, socketId: socket.id, eventType: 'socket.connected' },
          'Socket connected',
        );
      } catch (error) {
        logger.error({ err: error, userId: user.id }, 'Socket initialization failed');
        socket.disconnect(true);
        return;
      }
    })();

    socket.on('message:send', async (raw: unknown, ack: Ack = () => {}) => {
      const started = Date.now();
      try {
        if ((await consumeLimit('message', user.id, 10_000)) > 40)
          throw new AppError(429, 'RATE_LIMITED', 'Message rate limit exceeded');
        const input = socketMessageSchema.parse(raw);
        const message = await createMessage(input.conversationId, user.id, input);
        const payload = { clientMessageId: input.clientMessageId, message };
        io.to(conversationRoom(input.conversationId)).emit('message:new', payload);
        emitMetric('MessagesProcessed', 1);
        emitMetric('MessageAckLatency', Date.now() - started, 'Milliseconds');
        if (typeof ack === 'function') ack({ ok: true, ...payload });
      } catch (error) {
        emitMetric('MessageFailures', 1);
        if (typeof ack === 'function') ack({ ok: false, error: socketError(error) });
      }
    });

    socket.on('message:edit', async (raw: unknown, ack: Ack = () => {}) => {
      try {
        const input = socketEditMessageSchema.parse(raw);
        const message = await editMessage(input.messageId, user.id, input.content);
        io.to(conversationRoom(message.conversationId)).emit('message:edited', message);
        if (typeof ack === 'function') ack({ ok: true, message });
      } catch (error) {
        if (typeof ack === 'function') ack({ ok: false, error: socketError(error) });
      }
    });

    socket.on('message:delete', async (raw: unknown, ack: Ack = () => {}) => {
      try {
        const { messageId } = socketDeleteMessageSchema.parse(raw);
        const message = await deleteMessage(messageId, user.id);
        io.to(conversationRoom(message.conversationId)).emit('message:deleted', message);
        if (typeof ack === 'function') ack({ ok: true, messageId });
      } catch (error) {
        if (typeof ack === 'function') ack({ ok: false, error: socketError(error) });
      }
    });

    socket.on('message:delivered', async (raw: unknown, ack?: Ack) => {
      try {
        const input = receiptSchema.parse(raw);
        await requireMember(input.conversationId, user.id);
        const receipt = await markDelivered(input.messageId, user.id, input.conversationId);
        io.to(conversationRoom(input.conversationId)).emit('message:delivered', receipt);
        if (typeof ack === 'function') ack({ ok: true, receipt });
      } catch (error) {
        if (typeof ack === 'function') ack({ ok: false, error: socketError(error) });
      }
    });

    socket.on('message:read', async (raw: unknown, ack?: Ack) => {
      try {
        const input = receiptSchema.parse(raw);
        const receipt = await markRead(input.conversationId, input.messageId, user.id);
        io.to(conversationRoom(input.conversationId)).emit('message:read', receipt);
        if (typeof ack === 'function') ack({ ok: true, receipt });
      } catch (error) {
        if (typeof ack === 'function') ack({ ok: false, error: socketError(error) });
      }
    });

    for (const eventName of ['typing:start', 'typing:stop'] as const) {
      socket.on(eventName, async (raw: unknown, ack?: Ack) => {
        try {
          const input = typingSchema.parse(raw);
          if ((await consumeLimit('typing', user.id, 10_000)) > 30)
            throw new AppError(429, 'RATE_LIMITED', 'Typing rate limit exceeded');
          await requireMember(input.conversationId, user.id);
          if (eventName === 'typing:start') await refreshTyping(user.id, input.conversationId);
          else await stopTyping(user.id, input.conversationId);
          socket.to(conversationRoom(input.conversationId)).emit(eventName, {
            conversationId: input.conversationId,
            userId: user.id,
            username: user.username,
          });
          if (typeof ack === 'function') ack({ ok: true });
        } catch (error) {
          if (typeof ack === 'function') ack({ ok: false, error: socketError(error) });
        }
      });
    }

    socket.on('disconnect', async () => {
      clearTimeout(expiration);
      activeConnections = Math.max(0, activeConnections - 1);
      emitMetric('WebSocketConnections', activeConnections);
      try {
        if (await disconnectPresence(user.id, socket.id)) await emitPresence(user.id, false);
      } catch (error) {
        logger.warn({ err: error }, 'Disconnect cleanup deferred to presence sweep');
      }
      logger.info(
        { userId: user.id, socketId: socket.id, eventType: 'socket.disconnected' },
        'Socket disconnected',
      );
    });
  });

  setRealtimeServer(io);
  return io;
}
