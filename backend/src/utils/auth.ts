import jwt, { type SignOptions } from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { getRedis } from '../config/redis.js';
import { AppError } from './errors.js';

export type TokenPayload = { sub: string; username: string; jti: string; exp: number };

export function signToken(user: { id: string; username: string }): string {
  return jwt.sign({ username: user.username }, env.JWT_SECRET, {
    subject: user.id,
    jwtid: randomUUID(),
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
    issuer: 'relay-api',
    audience: 'relay-web',
  });
}

export function verifyToken(token: string): TokenPayload {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      issuer: 'relay-api',
      audience: 'relay-web',
      algorithms: ['HS256'],
    });
    if (
      typeof payload === 'string' ||
      !payload.sub ||
      typeof payload.username !== 'string' ||
      !payload.jti ||
      !payload.exp
    )
      throw new Error('Malformed token');
    return { sub: payload.sub, username: payload.username, jti: payload.jti, exp: payload.exp };
  } catch {
    throw new AppError(401, 'INVALID_TOKEN', 'Authentication is invalid or expired');
  }
}

export async function assertSession(payload: TokenPayload): Promise<void> {
  if (payload.exp <= Date.now() / 1000) throw new AppError(401, 'INVALID_TOKEN', 'Session expired');
  let revoked: number;
  try {
    const redis = await getRedis();
    revoked = await redis.exists(`session:revoked:${payload.jti}`);
  } catch {
    throw new AppError(
      503,
      'SESSION_STORE_UNAVAILABLE',
      'Session verification is temporarily unavailable',
    );
  }
  if (revoked) throw new AppError(401, 'INVALID_TOKEN', 'Session ended');
}

export async function revokeSession(payload: TokenPayload): Promise<void> {
  const redis = await getRedis();
  await redis.set(`session:revoked:${payload.jti}`, '1', {
    EX: Math.max(1, Math.ceil(payload.exp - Date.now() / 1000)),
  });
}
