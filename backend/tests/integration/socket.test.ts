import { createServer, type Server as HttpServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { io as client, type Socket } from 'socket.io-client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { createRealtimeServer } from '../../src/realtime/socket.js';
import { closeRealtimeServer } from '../../src/realtime/socket.js';
import { type Server } from 'socket.io';
import { requireTestDatabase } from './safety.js';
import { getRedis } from '../../src/config/redis.js';
import { onlineUsers } from '../../src/realtime/presence.js';

const run = process.env.RUN_INTEGRATION_TESTS === 'true' ? describe : describe.skip;
run('Socket.IO real-time delivery', () => {
  let server: HttpServer;
  let replica: HttpServer;
  let ioA: Server;
  let ioB: Server;
  let baseUrl = '';
  let replicaUrl = '';
  let aliceSocket: Socket;
  let bobSocket: Socket;
  let conversationId = '';
  let bobCookie = '';
  let bobId = '';
  let messageId = '';

  beforeAll(async () => {
    requireTestDatabase();
    const redis = await getRedis();
    for await (const key of redis.scanIterator({ MATCH: 'rate:auth:*' })) await redis.del(key);
    await prisma.messageReceipt.deleteMany();
    await prisma.message.deleteMany();
    await prisma.conversationMember.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.user.deleteMany();
    const app = createApp();
    server = createServer(app);
    replica = createServer(createApp());
    ioA = await createRealtimeServer(server);
    ioB = await createRealtimeServer(replica);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    await new Promise<void>((resolve) => replica.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Server did not start');
    baseUrl = `http://127.0.0.1:${address.port}`;
    const replicaAddress = replica.address();
    if (!replicaAddress || typeof replicaAddress === 'string')
      throw new Error('Replica did not start');
    replicaUrl = `http://127.0.0.1:${replicaAddress.port}`;
    const alice = await request(app).post('/api/auth/register').send({
      username: 'socketalice',
      displayName: 'Alice',
      email: 'socketalice@test.dev',
      password: 'StrongPass123',
    });
    const bob = await request(app).post('/api/auth/register').send({
      username: 'socketbob',
      displayName: 'Bob',
      email: 'socketbob@test.dev',
      password: 'StrongPass123',
    });
    const aliceCookie = alice.headers['set-cookie']?.[0]?.split(';')[0];
    bobCookie = bob.headers['set-cookie']?.[0]?.split(';')[0] ?? '';
    bobId = bob.body.user.id;
    const conversation = await request(app)
      .post('/api/conversations')
      .set('Cookie', aliceCookie!)
      .send({ type: 'DIRECT', memberIds: [bob.body.user.id] });
    conversationId = conversation.body.conversation.id;
    aliceSocket = client(baseUrl, {
      extraHeaders: { Cookie: aliceCookie! },
      transports: ['websocket'],
      forceNew: true,
    });
    bobSocket = client(replicaUrl, {
      extraHeaders: { Cookie: bobCookie },
      transports: ['websocket'],
      forceNew: true,
    });
    await Promise.all([
      new Promise<void>((resolve) => aliceSocket.on('connect', resolve)),
      new Promise<void>((resolve) => bobSocket.on('connect', resolve)),
    ]);
  });
  afterAll(async () => {
    aliceSocket?.disconnect();
    bobSocket?.disconnect();
    await Promise.all([closeRealtimeServer(ioA), closeRealtimeServer(ioB)]);
    await prisma.$disconnect();
  });

  it('delivers a persisted message and typing event to another client', async () => {
    const typing = new Promise<void>((resolve) =>
      bobSocket.once('typing:start', (event) => {
        expect(event.conversationId).toBe(conversationId);
        resolve();
      }),
    );
    aliceSocket.emit('typing:start', { conversationId });
    await typing;
    const received = new Promise<{ message: { id: string; content: string } }>((resolve) =>
      bobSocket.once('message:new', resolve),
    );
    aliceSocket.emit('message:send', {
      conversationId,
      clientMessageId: 'socket-1',
      content: 'Instant delivery',
      type: 'TEXT',
      attachments: [],
    });
    const payload = await received;
    messageId = payload.message.id;
    expect(payload.message.content).toBe('Instant delivery');
    expect(await prisma.message.count({ where: { clientMessageId: 'socket-1' } })).toBe(1);
  });

  it('propagates delivery and read receipts across replicas', async () => {
    const delivered = new Promise<{ messageId: string }>((resolve) =>
      aliceSocket.once('message:delivered', resolve),
    );
    bobSocket.emit('message:delivered', { conversationId, messageId });
    expect((await delivered).messageId).toBe(messageId);
    const read = new Promise<{ messageId: string }>((resolve) =>
      aliceSocket.once('message:read', resolve),
    );
    bobSocket.emit('message:read', { conversationId, messageId });
    expect((await read).messageId).toBe(messageId);
    expect(
      (
        await prisma.messageReceipt.findUnique({
          where: { messageId_userId: { messageId, userId: bobId } },
        })
      )?.readAt,
    ).toBeTruthy();
  });

  it('keeps a user online until their final tab disconnects', async () => {
    const extra = client(baseUrl, {
      extraHeaders: { Cookie: bobCookie },
      transports: ['websocket'],
      forceNew: true,
    });
    await new Promise<void>((resolve) => extra.once('connect', resolve));
    extra.disconnect();
    expect(await onlineUsers([bobId])).toEqual([bobId]);
    const offline = new Promise<void>((resolve) =>
      aliceSocket.once('presence:offline', ({ userId }) => {
        expect(userId).toBe(bobId);
        resolve();
      }),
    );
    bobSocket.disconnect();
    await offline;
    expect(await onlineUsers([bobId])).toEqual([]);
  });

  it('rejoins rooms after reconnect and retrieves missed persisted messages', async () => {
    const ack = await aliceSocket.timeout(5_000).emitWithAck('message:send', {
      conversationId,
      clientMessageId: 'while-offline',
      content: 'Catch up',
      type: 'TEXT',
    });
    expect(ack.ok).toBe(true);
    const history = await request(replicaUrl)
      .get(`/api/conversations/${conversationId}/messages`)
      .set('Cookie', bobCookie);
    expect(history.body.messages.some((m: { content: string }) => m.content === 'Catch up')).toBe(
      true,
    );
    bobSocket.connect();
    await new Promise<void>((resolve) => bobSocket.once('connect', resolve));
    const received = new Promise<{ message: { content: string } }>((resolve) =>
      bobSocket.once('message:new', resolve),
    );
    aliceSocket.emit('message:send', {
      conversationId,
      clientMessageId: 'after-reconnect',
      content: 'Welcome back',
    });
    expect((await received).message.content).toBe('Welcome back');
  });

  it('rejects anonymous sockets and non-member events', async () => {
    const outsider = client(baseUrl, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    await new Promise<void>((resolve) => outsider.once('connect_error', () => resolve()));
    outsider.disconnect();
    const ack = await aliceSocket.timeout(5_000).emitWithAck('message:send', {
      conversationId: '00000000-0000-4000-8000-000000000001',
      clientMessageId: 'unauthorized',
      content: 'No entry',
    });
    expect(ack.ok).toBe(false);
    expect(ack.error.code).toBe('NOT_A_MEMBER');
  });

  it('ignores malformed acknowledgement arguments without unhandled rejections', async () => {
    for (const event of ['message:delivered', 'message:read', 'typing:start', 'typing:stop']) {
      aliceSocket.emit(event, {}, { not: 'a callback' });
    }
    const ack = await aliceSocket.timeout(5_000).emitWithAck('typing:stop', { conversationId });
    expect(ack.ok).toBe(true);
  });
});
