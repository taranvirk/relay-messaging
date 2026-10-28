import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { conversationRoom, realtime } from '../realtime/emitter.js';
import { deleteMessage, editMessage } from '../services/message.service.js';
import { asyncHandler } from '../utils/async-handler.js';
import { editMessageSchema } from '../validators/messages.js';

export const messageRouter = Router();
messageRouter.use(requireAuth);

messageRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { content } = editMessageSchema.parse(req.body);
    const message = await editMessage(req.params.id!, req.user!.id, content);
    realtime()?.to(conversationRoom(message.conversationId)).emit('message:edited', message);
    res.json({ message });
  }),
);

messageRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const message = await deleteMessage(req.params.id!, req.user!.id);
    realtime()?.to(conversationRoom(message.conversationId)).emit('message:deleted', message);
    res.status(204).end();
  }),
);
