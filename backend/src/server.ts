import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/prisma.js';
import { closeRedis } from './config/redis.js';
import { closeRealtimeServer, createRealtimeServer } from './realtime/socket.js';
import { startOutboxDispatcher } from './queues/jobs.js';

const httpServer = createServer(createApp());
const io = await createRealtimeServer(httpServer);
const stopOutbox = startOutboxDispatcher();

httpServer.listen(env.PORT, () => logger.info({ port: env.PORT }, 'Relay API listening'));

async function shutdown(signal: string) {
  logger.info({ signal }, 'Graceful shutdown started');
  stopOutbox();
  setTimeout(() => process.exit(1), 15_000).unref();
  await closeRealtimeServer(io);
  await Promise.allSettled([prisma.$disconnect(), closeRedis()]);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
