import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { createLimiter, messageLimiter } from '../middleware/rate-limit.js';
import {
  addMember,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  removeMember,
  updateConversation,
  transferOwnership,
} from '../services/conversation.service.js';
import { createMessage, listMessages } from '../services/message.service.js';
import { asyncHandler } from '../utils/async-handler.js';
import {
  createConversationSchema,
  memberSchema,
  updateConversationSchema,
} from '../validators/conversations.js';
import { createMessageSchema, paginationSchema } from '../validators/messages.js';
import { receiptSchema } from '../validators/messages.js';
import { markRead } from '../services/message.service.js';
import { conversationRoom, realtime, userRoom } from '../realtime/emitter.js';

export const conversationRouter = Router();
conversationRouter.use(requireAuth);

conversationRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ conversations: await listConversations(req.user!.id) });
  }),
);

conversationRouter.post(
  '/',
  createLimiter,
  asyncHandler(async (req, res) => {
    const input = createConversationSchema.parse(req.body);
    const conversation = await createConversation(req.user!.id, input);
    for (const member of conversation.members) {
      realtime()?.in(userRoom(member.userId)).socketsJoin(conversationRoom(conversation.id));
    }
    realtime()?.to(conversationRoom(conversation.id)).emit('conversation:created', conversation);
    res.status(201).json({ conversation });
  }),
);

conversationRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ conversation: await getConversation(req.params.id!, req.user!.id) });
  }),
);

conversationRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { name } = updateConversationSchema.parse(req.body);
    const conversation = await updateConversation(req.params.id!, req.user!.id, name);
    realtime()?.to(conversationRoom(conversation.id)).emit('conversation:updated', conversation);
    res.json({ conversation });
  }),
);

conversationRouter.post(
  '/:id/owner',
  asyncHandler(async (req, res) => {
    const { userId } = memberSchema.parse(req.body);
    const conversation = await transferOwnership(req.params.id!, req.user!.id, userId);
    realtime()?.to(conversationRoom(conversation.id)).emit('conversation:updated', conversation);
    res.json({ conversation });
  }),
);

conversationRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await deleteConversation(req.params.id!, req.user!.id);
    realtime()
      ?.to(conversationRoom(req.params.id!))
      .emit('conversation:deleted', { conversationId: req.params.id });
    realtime()?.in(conversationRoom(req.params.id!)).socketsLeave(conversationRoom(req.params.id!));
    res.status(204).end();
  }),
);

conversationRouter.post(
  '/:id/members',
  createLimiter,
  asyncHandler(async (req, res) => {
    const input = memberSchema.parse(req.body);
    const conversation = await addMember(req.params.id!, req.user!.id, input.userId, input.role);
    realtime()?.in(userRoom(input.userId)).socketsJoin(conversationRoom(req.params.id!));
    realtime()?.to(conversationRoom(req.params.id!)).emit('conversation:updated', conversation);
    res.status(201).json({ conversation });
  }),
);

conversationRouter.delete(
  '/:id/members/:userId',
  asyncHandler(async (req, res) => {
    await removeMember(req.params.id!, req.user!.id, req.params.userId!);
    realtime()?.to(conversationRoom(req.params.id!)).emit('member:removed', {
      conversationId: req.params.id,
      userId: req.params.userId,
    });
    realtime()?.in(userRoom(req.params.userId!)).socketsLeave(conversationRoom(req.params.id!));
    res.status(204).end();
  }),
);

conversationRouter.get(
  '/:id/messages',
  asyncHandler(async (req, res) => {
    const { cursor, limit } = paginationSchema.parse(req.query);
    res.json(await listMessages(req.params.id!, req.user!.id, cursor, limit));
  }),
);

conversationRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const { messageId } = receiptSchema.omit({ conversationId: true }).parse(req.body);
    const receipt = await markRead(req.params.id!, messageId, req.user!.id);
    realtime()?.to(conversationRoom(req.params.id!)).emit('message:read', receipt);
    res.json({ receipt });
  }),
);

conversationRouter.post(
  '/:id/messages',
  messageLimiter,
  asyncHandler(async (req, res) => {
    const input = createMessageSchema.parse(req.body);
    const message = await createMessage(req.params.id!, req.user!.id, input);
    realtime()
      ?.to(conversationRoom(req.params.id!))
      .emit('message:new', { clientMessageId: input.clientMessageId, message });
    res.status(201).json({ clientMessageId: input.clientMessageId, message });
  }),
);
