import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { uploadLimiter } from '../middleware/rate-limit.js';
import { createDownloadUrl, createUploadUrl } from '../services/attachment.service.js';
import { asyncHandler } from '../utils/async-handler.js';
import { attachmentSchema } from '../validators/messages.js';

export const attachmentRouter = Router();
attachmentRouter.use(requireAuth);

attachmentRouter.post(
  '/presign',
  uploadLimiter,
  asyncHandler(async (req, res) => {
    const input = attachmentSchema.omit({ storageKey: true }).parse(req.body);
    res.json(await createUploadUrl(req.user!.id, input.fileName, input.mimeType, input.fileSize));
  }),
);

attachmentRouter.get(
  '/:id/url',
  asyncHandler(async (req, res) => {
    const attachmentId = z.string().uuid().parse(req.params.id);
    res.json(await createDownloadUrl(attachmentId, req.user!.id));
  }),
);
