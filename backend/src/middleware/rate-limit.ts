import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { getRedis } from '../config/redis.js';

const response = {
  error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again shortly.' },
};

export async function consumeLimit(
  name: string,
  identity: string,
  windowMs: number,
): Promise<number> {
  const redis = await getRedis();
  const digest = createHash('sha256').update(identity).digest('hex').slice(0, 24);
  const key = `rate:${name}:${digest}:${Math.floor(Date.now() / windowMs)}`;
  return Number(
    await redis.eval(
      "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end; return n",
      { keys: [key], arguments: [String(windowMs + 1_000)] },
    ),
  );
}

function distributedLimit(name: string, windowMs: number, limit: number): RequestHandler {
  const fallback = rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: response,
  });
  return (req, res, next) => {
    void (async () => {
      try {
        const identity = req.user?.id ?? req.ip ?? 'unknown';
        const count = await consumeLimit(name, identity, windowMs);
        res.setHeader('RateLimit-Limit', String(limit));
        res.setHeader('RateLimit-Remaining', String(Math.max(0, limit - count)));
        if (count > limit) return res.status(429).json(response);
        next();
      } catch {
        fallback(req, res, next);
      }
    })();
  };
}

export const authLimiter = distributedLimit('auth', 15 * 60_000, 20);
export const searchLimiter = distributedLimit('search', 60_000, 60);
export const createLimiter = distributedLimit('create', 60_000, 30);
export const messageLimiter = distributedLimit('message', 10_000, 40);
export const uploadLimiter = distributedLimit('upload', 60_000, 20);
