import { Router } from 'express';
import { env } from '../config/env.js';
import { SESSION_COOKIE, requireAuth } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rate-limit.js';
import { authenticateUser, getCurrentUser, registerUser } from '../services/auth.service.js';
import { asyncHandler } from '../utils/async-handler.js';
import { revokeSession, signToken, verifyToken } from '../utils/auth.js';
import { parse } from 'cookie';
import { realtime } from '../realtime/emitter.js';
import { loginSchema, registerSchema } from '../validators/auth.js';

export const authRouter = Router();

const cookieOptions = {
  httpOnly: true,
  secure: env.COOKIE_SECURE || env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
};

authRouter.post(
  '/register',
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const user = await registerUser(input);
    res.cookie(SESSION_COOKIE, signToken(user), cookieOptions).status(201).json({ user });
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = await authenticateUser(input.email, input.password);
    res.cookie(SESSION_COOKIE, signToken(user), cookieOptions).json({ user });
  }),
);

authRouter.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    const bearer = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : undefined;
    const payload = verifyToken(bearer ?? parse(req.headers.cookie ?? '')[SESSION_COOKIE] ?? '');
    await revokeSession(payload);
    realtime()?.in(`session:${payload.jti}`).disconnectSockets(true);
    res
      .clearCookie(SESSION_COOKIE, { ...cookieOptions, maxAge: undefined })
      .status(204)
      .end();
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: await getCurrentUser(req.user!.id) });
  }),
);
