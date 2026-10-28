import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../src/config/prisma.js';
import { processJob } from '../../src/queues/jobs.js';
import { requireTestDatabase } from './safety.js';
import { env } from '../../src/config/env.js';
import { createMessage } from '../../src/services/message.service.js';

const run = process.env.RUN_INTEGRATION_TESTS === 'true' ? describe : describe.skip;
run('at-least-once background audit jobs', () => {
  afterAll(() => prisma.$disconnect());
  it('persists only one audit on repeated delivery', async () => {
    requireTestDatabase();
    const job = {
      jobId: randomUUID(),
      messageId: randomUUID(),
      conversationId: randomUUID(),
      type: 'MESSAGE_CREATED',
    };
    await processJob(job);
    await processJob(job);
    expect(await prisma.auditEvent.count({ where: { id: job.jobId } })).toBe(1);
  });
  it('rejects unknown job payloads', async () => {
    await expect(processJob({ type: 'RUN_COMMAND', command: 'unsafe' })).rejects.toThrow();
  });
  it('commits the queue outbox atomically with a message', async () => {
    requireTestDatabase();
    const id = randomUUID();
    const user = await prisma.user.create({
      data: {
        email: `${id}@test.invalid`,
        username: `job_${id.slice(0, 8)}`,
        displayName: 'Queue fixture',
        passwordHash: 'unusable-test-fixture',
      },
    });
    const conversation = await prisma.conversation.create({
      data: {
        type: 'GROUP',
        name: 'Audit fixture',
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });
    const previous = env.QUEUE_URL;
    env.QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/000000000000/test';
    try {
      const message = await createMessage(conversation.id, user.id, {
        clientMessageId: randomUUID(),
        content: 'Durable outbox',
        type: 'TEXT',
      });
      const job = await prisma.outboxJob.findFirst({
        where: { payload: { path: ['messageId'], equals: message.id } },
      });
      expect(job?.dispatchedAt).toBeNull();
      expect(job?.payload).toMatchObject({ messageId: message.id, type: 'MESSAGE_CREATED' });
    } finally {
      env.QUEUE_URL = previous;
    }
  });
});
