import { prisma } from '../config/prisma.js';
import { getRedis } from '../config/redis.js';
// Atomic leases avoid first/last-tab races across replicas. A sweeper expires
// connections whose process died without sending a disconnect event.
const timers = new Map<string, NodeJS.Timeout>();
const index = 'presence:leases';
const key = (userId: string) => `presence:user:${userId}`;
const joinScript = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
local previous = redis.call('ZCARD', KEYS[1])
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
redis.call('PEXPIRE', KEYS[1], 180000)
redis.call('ZADD', KEYS[2], ARGV[2], ARGV[4])
return previous == 0 and 1 or 0`;
const leaveScript = `
redis.call('ZREM', KEYS[1], ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
local latest = redis.call('ZRANGE', KEYS[1], -1, -1, 'WITHSCORES')
if #latest == 0 then
  local removed = redis.call('ZREM', KEYS[2], ARGV[3])
  redis.call('DEL', KEYS[1])
  return removed
end
redis.call('ZADD', KEYS[2], latest[2], ARGV[3])
return 0`;

export async function connectPresence(userId: string, socketId: string): Promise<boolean> {
  const redis = await getRedis();
  const refresh = () =>
    redis.eval(joinScript, {
      keys: [key(userId), index],
      arguments: [String(Date.now()), String(Date.now() + 90_000), socketId, userId],
    });
  const first = await refresh();
  const timer = setInterval(() => {
    void refresh().catch(() => undefined);
  }, 30_000);
  timer.unref();
  timers.set(socketId, timer);
  return first === 1;
}

export async function disconnectPresence(userId: string, socketId: string): Promise<boolean> {
  clearInterval(timers.get(socketId));
  timers.delete(socketId);
  const redis = await getRedis();
  const last = await redis.eval(leaveScript, {
    keys: [key(userId), index],
    arguments: [String(Date.now()), socketId, userId],
  });
  if (last === 1)
    await prisma.user.updateMany({ where: { id: userId }, data: { lastSeenAt: new Date() } });
  return last === 1;
}

export async function onlineUsers(userIds: string[]): Promise<string[]> {
  const redis = await getRedis();
  const result = await Promise.all(
    userIds.map(async (id) => ((await redis.zCount(key(id), Date.now(), '+inf')) > 0 ? id : null)),
  );
  return result.filter((id): id is string => id !== null);
}

export async function sweepPresence(): Promise<string[]> {
  const redis = await getRedis();
  const expired = await redis.zRangeByScore(index, '-inf', Date.now(), {
    LIMIT: { offset: 0, count: 100 },
  });
  const offline: string[] = [];
  for (const id of expired) {
    if (
      (await redis.eval(leaveScript, {
        keys: [key(id), index],
        arguments: [String(Date.now()), '', id],
      })) === 1
    ) {
      await prisma.user.updateMany({ where: { id }, data: { lastSeenAt: new Date() } });
      offline.push(id);
    }
  }
  return offline;
}

export async function refreshTyping(userId: string, conversationId: string): Promise<void> {
  try {
    const redis = await getRedis();
    await redis.set(`typing:${conversationId}:${userId}`, '1', { EX: 6 });
  } catch {
    // The socket's stop event and client timeout provide the development fallback.
  }
}

export async function stopTyping(userId: string, conversationId: string): Promise<void> {
  try {
    const redis = await getRedis();
    await redis.del(`typing:${conversationId}:${userId}`);
  } catch {
    // No durable state is written for typing indicators.
  }
}
