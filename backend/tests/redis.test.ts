import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { closeRedis, getRedis } from '../src/config/redis.js';

const mock = vi.hoisted(() => {
  const client = { isOpen: false, isReady: false, on: vi.fn(), connect: vi.fn(), quit: vi.fn() };
  return { client, createClient: vi.fn(() => client) };
});
vi.mock('redis', () => ({ createClient: mock.createClient }));

beforeEach(() => {
  vi.clearAllMocks();
  mock.client.isOpen = false;
  mock.client.isReady = false;
  mock.client.connect.mockImplementation(async () => {
    mock.client.isOpen = true;
    await Promise.resolve();
    mock.client.isReady = true;
  });
  mock.client.quit.mockImplementation(async () => {
    mock.client.isOpen = false;
    mock.client.isReady = false;
  });
});
afterEach(closeRedis);

it('shares one connection attempt across concurrent requests', async () => {
  const [first, second] = await Promise.all([getRedis(), getRedis()]);
  expect(first).toBe(second);
  expect(mock.client.connect).toHaveBeenCalledTimes(1);
  expect(mock.createClient).toHaveBeenCalledWith(
    expect.objectContaining({
      disableOfflineQueue: true,
      socket: expect.objectContaining({ connectTimeout: 1500, reconnectStrategy: false }),
    }),
  );
});

it('rejects an unready connection instead of queueing and reconnects on the next request', async () => {
  await getRedis();
  mock.client.isReady = false;
  await expect(getRedis()).rejects.toThrow('temporarily unavailable');
  mock.client.isOpen = false;
  await expect(getRedis()).resolves.toBe(mock.client);
  expect(mock.client.connect).toHaveBeenCalledTimes(2);
});

it('permits a new connection attempt after a failed attempt', async () => {
  mock.client.connect.mockRejectedValueOnce(new Error('Connection refused'));
  await expect(getRedis()).rejects.toThrow('Connection refused');
  await expect(getRedis()).resolves.toBe(mock.client);
});
