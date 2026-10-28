import { beforeEach, expect, it, vi } from 'vitest';
import { assertSession } from '../src/utils/auth.js';

const redis = vi.hoisted(() => ({ exists: vi.fn(), connect: vi.fn() }));
vi.mock('../src/config/redis.js', () => ({ getRedis: redis.connect }));
const session = { sub: 'alice', username: 'alice', jti: 'session-id', exp: 4_000_000_000 };

beforeEach(() => {
  redis.connect.mockReset().mockResolvedValue(redis);
  redis.exists.mockReset().mockResolvedValue(0);
});

it('fails closed with a service-unavailable error when Redis cannot connect', async () => {
  redis.connect.mockRejectedValue(new Error('Connection refused'));
  await expect(assertSession(session)).rejects.toMatchObject({
    status: 503,
    code: 'SESSION_STORE_UNAVAILABLE',
  });
});

it('fails closed when the revocation lookup fails', async () => {
  redis.exists.mockRejectedValue(new Error('Connection lost'));
  await expect(assertSession(session)).rejects.toMatchObject({
    status: 503,
    code: 'SESSION_STORE_UNAVAILABLE',
  });
});

it('rejects revoked sessions and accepts active sessions', async () => {
  redis.exists.mockResolvedValueOnce(1);
  await expect(assertSession(session)).rejects.toMatchObject({
    status: 401,
    code: 'INVALID_TOKEN',
  });
  await expect(assertSession(session)).resolves.toBeUndefined();
});

it('rejects expiration without querying Redis', async () => {
  await expect(assertSession({ ...session, exp: 1 })).rejects.toMatchObject({ status: 401 });
  expect(redis.connect).not.toHaveBeenCalled();
});
