import { describe, expect, it } from 'vitest';
import { signToken, verifyToken } from '../src/utils/auth.js';
import { registerSchema } from '../src/validators/auth.js';

describe('authentication primitives', () => {
  it('signs and verifies a scoped token', () => {
    const token = signToken({ id: '42f589e0-5526-44fc-8a22-674a9364d155', username: 'maya' });
    expect(verifyToken(token)).toMatchObject({
      sub: '42f589e0-5526-44fc-8a22-674a9364d155',
      username: 'maya',
    });
    expect(verifyToken(token).jti).toBeTruthy();
  });

  it('rejects weak passwords', () => {
    expect(() =>
      registerSchema.parse({
        username: 'maya',
        displayName: 'Maya',
        email: 'maya@example.com',
        password: 'password',
      }),
    ).toThrow();
  });
  it('rejects a tampered signature', () => {
    const token = signToken({ id: '42f589e0-5526-44fc-8a22-674a9364d155', username: 'maya' });
    expect(() => verifyToken(`${token.slice(0, -4)}xxxx`)).toThrow();
  });
});
