import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { processJob } from './queues/jobs.js';
import { prisma } from './config/prisma.js';

if (!env.QUEUE_URL) throw new Error('QUEUE_URL is required for the worker');
const sqs = new SQSClient({ region: env.AWS_REGION });
let running = true;

process.on('SIGTERM', () => {
  running = false;
});
process.on('SIGINT', () => {
  running = false;
});

logger.info('Relay worker started');
while (running) {
  try {
    const result = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: env.QUEUE_URL,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 20,
        VisibilityTimeout: 60,
      }),
    );
    for (const message of result.Messages ?? []) {
      try {
        await processJob(JSON.parse(message.Body ?? '{}'));
        logger.info({ queueMessageId: message.MessageId }, 'Background audit persisted');
        if (message.ReceiptHandle)
          await sqs.send(
            new DeleteMessageCommand({
              QueueUrl: env.QUEUE_URL,
              ReceiptHandle: message.ReceiptHandle,
            }),
          );
      } catch (error) {
        logger.error({ err: error, messageId: message.MessageId }, 'Background job failed');
      }
    }
  } catch (error) {
    logger.error({ err: error }, 'Worker poll failed');
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}
await prisma.$disconnect();
