import type { NextFunction, Request, Response } from 'express';
import { parse } from 'cookie';
import { assertSession, verifyToken } from '../utils/auth.js';
import { AppError } from '../utils/errors.js';

export const SESSION_COOKIE = 'relay_session';

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : undefined;
  const token = bearer ?? parse(req.headers.cookie ?? '')[SESSION_COOKIE];
  if (!token) return next(new AppError(401, 'AUTH_REQUIRED', 'Authentication required'));
  void (async () => {
    try {
      const payload = verifyToken(token);
      await assertSession(payload);
      req.user = { id: payload.sub, username: payload.username };
      next();
    } catch (error) {
      next(error);
    }
  })();
}
