import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { prisma } from '../config/prisma.js';
import { z } from 'zod';

const sqs = env.QUEUE_URL ? new SQSClient({ region: env.AWS_REGION }) : null;

export const backgroundJobSchema = z.object({
  jobId: z.string().uuid(),
  type: z.literal('MESSAGE_CREATED'),
  messageId: z.string().uuid(),
  conversationId: z.string().uuid(),
});
export type BackgroundJob = z.infer<typeof backgroundJobSchema>;

export async function enqueueJob(job: BackgroundJob): Promise<void> {
  if (!sqs || !env.QUEUE_URL) return;
  await sqs.send(
    new SendMessageCommand({ QueueUrl: env.QUEUE_URL, MessageBody: JSON.stringify(job) }),
  );
  logger.debug({ jobType: job.type }, 'Background job enqueued');
}

export async function dispatchOutbox(): Promise<void> {
  if (!sqs) return;
  const jobs = await prisma.outboxJob.findMany({
    where: { dispatchedAt: null },
    orderBy: { createdAt: 'asc' },
    take: 25,
  });
  for (const job of jobs) {
    try {
      await enqueueJob(
        backgroundJobSchema.parse({ ...(job.payload as Record<string, unknown>), jobId: job.id }),
      );
      await prisma.outboxJob.update({
        where: { id: job.id },
        data: { dispatchedAt: new Date(), attempts: { increment: 1 }, lastError: null },
      });
    } catch (error) {
      logger.warn({ err: error, jobId: job.id }, 'Outbox delivery will retry');
      await prisma.outboxJob.update({
        where: { id: job.id },
        data: { attempts: { increment: 1 }, lastError: 'Dispatch failed; inspect worker/API logs' },
      });
    }
  }
}

export async function processJob(raw: unknown): Promise<void> {
  const job = backgroundJobSchema.parse(raw);
  // The stable outbox ID makes at-least-once queue deliveries safe. Audit records
  // contain identifiers only, never private message content or credentials.
  await prisma.auditEvent.upsert({
    where: { id: job.jobId },
    create: { id: job.jobId, type: job.type, messageId: job.messageId },
    update: {},
  });
}

export function startOutboxDispatcher(): () => void {
  if (!sqs) return () => {};
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await dispatchOutbox();
    } catch (error) {
      logger.error({ err: error }, 'Outbox scan failed');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => {
    void tick();
  }, 2_000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
