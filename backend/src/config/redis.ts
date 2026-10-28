import { createClient, type RedisClientType } from 'redis';
import { env } from './env.js';
import { logger } from './logger.js';

let client: RedisClientType | null = null;
let connecting: Promise<void> | null = null;

export async function getRedis(): Promise<RedisClientType> {
  if (!client) {
    client = createClient({
      url: env.REDIS_URL,
      // Do not leave session checks and readiness requests queued through an
      // outage. Callers fail closed and retry after the service recovers.
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 1_500,
        // Session lookups must have a bounded failure time. Subsequent requests
        // reconnect this client; the adapter uses independent retrying clients.
        reconnectStrategy: false,
      },
    });
    client.on('error', (error) => logger.error({ err: error }, 'Redis client error'));
  }
  if (!client.isOpen && !connecting) {
    connecting = client
      .connect()
      .then(() => {})
      .finally(() => {
        connecting = null;
      });
  }
  if (connecting) await connecting;
  if (!client.isReady) throw new Error('Redis is temporarily unavailable');
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client?.isOpen) await client.quit();
  client = null;
  connecting = null;
}
