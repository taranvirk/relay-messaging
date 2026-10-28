import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/prisma.js';
import { getRedis } from './config/redis.js';
import { AppError, errorHandler, notFound } from './utils/errors.js';
import { attachmentRouter } from './routes/attachment.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { conversationRouter } from './routes/conversation.routes.js';
import { messageRouter } from './routes/message.routes.js';
import { userRouter } from './routes/user.routes.js';
import { z } from 'zod';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin: env.FRONTEND_ORIGIN.split(',').map((value) => value.trim()),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '128kb' }));
  app.use((req, _res, next) => {
    const origin = req.header('origin');
    if (
      origin &&
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      !env.FRONTEND_ORIGIN.split(',')
        .map((value) => value.trim())
        .includes(origin)
    ) {
      return next(new AppError(403, 'INVALID_ORIGIN', 'Untrusted request origin'));
    }
    next();
  });
  app.use((req, res, next) => {
    req.requestId = req.header('x-request-id') ?? randomUUID();
    res.setHeader('x-request-id', req.requestId);
    next();
  });
  app.use(pinoHttp({ logger, customProps: (req) => ({ requestId: req.requestId }) }));

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/config', (_req, res) =>
    res.json({ attachmentsEnabled: Boolean(env.ATTACHMENTS_BUCKET) }),
  );
  app.get('/api/health/ready', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      const redis = await getRedis();
      await redis.ping();
      res.json({ status: 'ready' });
    } catch (error) {
      logger.warn({ err: error }, 'Readiness check failed');
      res.status(503).json({ status: 'not_ready' });
    }
  });

  app.use('/api/auth', authRouter);
  for (const router of [userRouter, conversationRouter, messageRouter, attachmentRouter]) {
    for (const parameter of ['id', 'userId'])
      router.param(parameter, (_req, _res, next, value: string) => {
        const result = z.string().uuid().safeParse(value);
        next(
          result.success ? undefined : new AppError(400, 'INVALID_ID', 'A valid UUID is required'),
        );
      });
  }
  app.use('/api/users', userRouter);
  app.use('/api/conversations', conversationRouter);
  app.use('/api/messages', messageRouter);
  app.use('/api/attachments', attachmentRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
