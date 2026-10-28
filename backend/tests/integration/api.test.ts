import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { requireTestDatabase } from './safety.js';
import { getRedis } from '../../src/config/redis.js';

const run = process.env.RUN_INTEGRATION_TESTS === 'true' ? describe : describe.skip;
run('Relay REST authorization and messaging', () => {
  const app = createApp();
  const alice = request.agent(app);
  const bob = request.agent(app);
  const eve = request.agent(app);
  let aliceId = '';
  let bobId = '';
  let conversationId = '';
  let messageId = '';

  beforeAll(async () => {
    requireTestDatabase();
    const redis = await getRedis();
    for await (const key of redis.scanIterator({ MATCH: 'rate:auth:*' })) await redis.del(key);
    await prisma.messageReceipt.deleteMany();
    await prisma.attachment.deleteMany();
    await prisma.message.deleteMany();
    await prisma.conversationMember.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.user.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('registers three users and restores the authenticated session', async () => {
    const registrations = await Promise.all([
      alice.post('/api/auth/register').send({
        username: 'alice',
        displayName: 'Alice',
        email: 'alice@test.dev',
        password: 'StrongPass123',
      }),
      bob.post('/api/auth/register').send({
        username: 'bob',
        displayName: 'Bob',
        email: 'bob@test.dev',
        password: 'StrongPass123',
      }),
      eve.post('/api/auth/register').send({
        username: 'eve',
        displayName: 'Eve',
        email: 'eve@test.dev',
        password: 'StrongPass123',
      }),
    ]);
    expect(registrations.every((response) => response.status === 201)).toBe(true);
    aliceId = registrations[0]!.body.user.id;
    bobId = registrations[1]!.body.user.id;
    expect((await alice.get('/api/auth/me')).body.user.email).toBe('alice@test.dev');
  });

  it('creates an idempotent direct conversation and message', async () => {
    const created = await alice
      .post('/api/conversations')
      .send({ type: 'DIRECT', memberIds: [bobId] });
    expect(created.status).toBe(201);
    conversationId = created.body.conversation.id;
    const first = await alice
      .post(`/api/conversations/${conversationId}/messages`)
      .send({ clientMessageId: 'retry-safe-1', content: 'Hello Bob' });
    const retry = await alice
      .post(`/api/conversations/${conversationId}/messages`)
      .send({ clientMessageId: 'retry-safe-1', content: 'Hello Bob' });
    expect(first.status).toBe(201);
    expect(retry.body.message.id).toBe(first.body.message.id);
    messageId = first.body.message.id;
  });

  it('searches users, updates profiles, and never exposes password hashes', async () => {
    const search = await alice.get('/api/users/search?q=bob');
    expect(search.status).toBe(200);
    expect(search.body.users.some((user: { id: string }) => user.id === bobId)).toBe(true);
    expect(search.body.users.some((user: Record<string, unknown>) => 'passwordHash' in user)).toBe(
      false,
    );
    const profile = await alice.patch('/api/users/me').send({ displayName: 'Alice updated' });
    expect(profile.status).toBe(200);
    expect(profile.body.user.displayName).toBe('Alice updated');
    expect((await alice.get(`/api/users/${bobId}`)).body.user.id).toBe(bobId);
    expect((await request(app).get(`/api/users/${bobId}`)).status).toBe(401);
  });

  it('prevents an outsider from reading or writing the private conversation', async () => {
    expect((await eve.get(`/api/conversations/${conversationId}/messages`)).status).toBe(403);
    expect(
      (
        await eve
          .post(`/api/conversations/${conversationId}/messages`)
          .send({ clientMessageId: 'attack-1', content: 'intrusion' })
      ).status,
    ).toBe(403);
  });

  it('allows only the author to edit and soft-delete a message', async () => {
    expect(
      (await bob.patch(`/api/messages/${messageId}`).send({ content: 'changed' })).status,
    ).toBe(403);
    expect(
      (await alice.patch(`/api/messages/${messageId}`).send({ content: 'Edited safely' })).body
        .message.content,
    ).toBe('Edited safely');
    expect((await alice.delete(`/api/messages/${messageId}`)).status).toBe(204);
    const history = await bob.get(`/api/conversations/${conversationId}/messages`);
    expect(history.body.messages[0].deletedAt).toBeTruthy();
    expect(history.body.messages[0].content).toBe('');
  });

  it('enforces group role hierarchy', async () => {
    const group = await alice
      .post('/api/conversations')
      .send({ type: 'GROUP', name: 'Ops', memberIds: [bobId] });
    const groupId = group.body.conversation.id;
    expect((await bob.delete(`/api/conversations/${groupId}/members/${aliceId}`)).status).toBe(403);
    expect(
      (await alice.post(`/api/conversations/${groupId}/owner`).send({ userId: bobId })).status,
    ).toBe(200);
    expect((await alice.delete(`/api/conversations/${groupId}/members/${aliceId}`)).status).toBe(
      204,
    );
    expect((await alice.get(`/api/conversations/${groupId}`)).status).toBe(403);
    expect((await bob.delete(`/api/conversations/${groupId}`)).status).toBe(204);
  });

  it('paginates without gaps and deduplicates concurrent retries', async () => {
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        alice
          .post(`/api/conversations/${conversationId}/messages`)
          .send({ clientMessageId: `page-${n}`, content: `Page ${n}` }),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const first = await bob.get(`/api/conversations/${conversationId}/messages?limit=2`);
    const second = await bob.get(
      `/api/conversations/${conversationId}/messages?limit=2&cursor=${first.body.nextCursor}`,
    );
    expect(
      new Set([...first.body.messages, ...second.body.messages].map((m: { id: string }) => m.id))
        .size,
    ).toBe(4);
    const retries = await Promise.all(
      [1, 2].map(() =>
        alice
          .post(`/api/conversations/${conversationId}/messages`)
          .send({ clientMessageId: 'concurrent-retry', content: 'One message' }),
      ),
    );
    expect(retries[0]?.body.message.id).toBe(retries[1]?.body.message.id);
    expect(await prisma.message.count({ where: { clientMessageId: 'concurrent-retry' } })).toBe(1);
  });

  it('hydrates paginated history with fresh public senders, replies, and receipts', async () => {
    const original = await alice
      .post(`/api/conversations/${conversationId}/messages`)
      .send({ clientMessageId: 'hydrate-original', content: 'Reply target' });
    const reply = await bob.post(`/api/conversations/${conversationId}/messages`).send({
      clientMessageId: 'hydrate-reply',
      content: 'A reply',
      replyToMessageId: original.body.message.id,
    });
    expect(reply.status).toBe(201);
    await alice
      .patch(`/api/messages/${original.body.message.id}`)
      .send({ content: 'Updated reply target' });
    const history = await bob.get(`/api/conversations/${conversationId}/messages?limit=2`);
    expect(history.status).toBe(200);
    const hydrated = history.body.messages.find(
      (message: { id: string }) => message.id === reply.body.message.id,
    );
    expect(hydrated.sender.id).toBe(bobId);
    expect(hydrated.sender.passwordHash).toBeUndefined();
    expect(hydrated.replyTo.content).toBe('Updated reply target');
    expect(hydrated.replyTo.sender.displayName).toBe('Alice updated');
    expect(hydrated.receipts[0].userId).toBe(aliceId);
    expect(hydrated.attachments).toEqual([]);
    await alice.delete(`/api/messages/${original.body.message.id}`);
    const deleted = await bob.get(`/api/conversations/${conversationId}/messages?limit=2`);
    expect(
      deleted.body.messages.find((message: { id: string }) => message.id === reply.body.message.id)
        .replyTo.content,
    ).toBe('');
  });

  it('rejects forged upload ownership and untrusted origins', async () => {
    expect(
      (
        await alice.post(`/api/conversations/${conversationId}/messages`).send({
          clientMessageId: 'bad-file',
          content: 'file',
          attachments: [
            {
              storageKey: `users/${bobId}/file.txt`,
              fileName: 'file.txt',
              mimeType: 'text/plain',
              fileSize: 3,
            },
          ],
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await alice
          .patch('/api/users/me')
          .set('Origin', 'https://attacker.invalid')
          .send({ displayName: 'Changed' })
      ).status,
    ).toBe(403);
  });

  it('revokes the authenticated session on logout', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@test.dev', password: 'StrongPass123' });
    const cookie = login.headers['set-cookie']?.[0]?.split(';')[0];
    expect((await request(app).post('/api/auth/logout').set('Cookie', cookie!)).status).toBe(204);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie!)).status).toBe(401);
  });
  it('advances read pointers monotonically and clears unread counts', async () => {
    const latest = await bob.get(`/api/conversations/${conversationId}/messages?limit=2`);
    const [earlier, later] = latest.body.messages as Array<{ id: string }>;
    expect(
      (await bob.post(`/api/conversations/${conversationId}/read`).send({ messageId: later!.id }))
        .status,
    ).toBe(200);
    await bob.post(`/api/conversations/${conversationId}/read`).send({ messageId: earlier!.id });
    const member = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: bobId } },
    });
    expect(member?.lastReadMessageId).toBe(later!.id);
    const list = await bob.get('/api/conversations');
    expect(
      list.body.conversations.find((c: { id: string }) => c.id === conversationId).unreadCount,
    ).toBe(0);
  });
});
