import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { logger } from '../config/logger.js';

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function notFound(_req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(404, 'NOT_FOUND', 'Route not found'));
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: error.flatten() },
    });
    return;
  }
  if (error instanceof AppError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    res
      .status(409)
      .json({ error: { code: 'CONFLICT', message: 'A record with these details already exists' } });
    return;
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    ['P2025', 'P2003'].includes(error.code)
  ) {
    res.status(404).json({
      error: { code: 'RECORD_NOT_FOUND', message: 'The referenced record is unavailable' },
    });
    return;
  }
  logger.error({ err: error, requestId: req.requestId }, 'Unhandled request error');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
}
