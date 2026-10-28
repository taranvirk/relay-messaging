import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/errors.js';
import { messageInclude, publicUserSelect } from '../utils/selects.js';
import { requireMember } from './conversation.service.js';
import { env } from '../config/env.js';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { validateUploads } from './attachment.service.js';

type AttachmentInput = { fileName: string; mimeType: string; fileSize: number; storageKey: string };
type MessageInput = {
  clientMessageId: string;
  content: string;
  type: 'TEXT' | 'IMAGE' | 'FILE';
  replyToMessageId?: string | null;
  attachments?: AttachmentInput[];
};

export async function listMessages(
  conversationId: string,
  userId: string,
  cursor: string | undefined,
  limit: number,
) {
  await requireMember(conversationId, userId);
  if (
    cursor &&
    !(await prisma.message.findFirst({
      where: { id: cursor, conversationId },
      select: { id: true },
    }))
  )
    throw new AppError(400, 'INVALID_CURSOR', 'Cursor must belong to this conversation');
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = messages.length > limit;
  const page = hasMore ? messages.slice(0, limit) : messages;
  const nextCursor = hasMore ? (page.at(-1)?.id ?? null) : null;
  if (!page.length) return { messages: [], nextCursor };

  // Hydrate only the returned page, not the pagination sentinel. The query
  // engine otherwise materializes the same nested user once per message. Batch
  // indexed relations and share each public user record within this response;
  // nothing is cached across requests or bypasses the membership check above.
  const messageIds = page.map((message) => message.id);
  const replyIds = [
    ...new Set(
      page.flatMap((message) => (message.replyToMessageId ? [message.replyToMessageId] : [])),
    ),
  ];
  const replies = replyIds.length
    ? await prisma.message.findMany({
        where: { id: { in: replyIds }, conversationId },
        select: { id: true, content: true, senderId: true },
      })
    : [];
  const userIds = [
    ...new Set(
      [...page, ...replies].flatMap((message) => (message.senderId ? [message.senderId] : [])),
    ),
  ];
  const [users, receipts, attachments] = await Promise.all([
    userIds.length
      ? prisma.user.findMany({ where: { id: { in: userIds } }, select: publicUserSelect })
      : [],
    prisma.messageReceipt.findMany({
      where: { messageId: { in: messageIds } },
      select: { messageId: true, userId: true, deliveredAt: true, readAt: true },
    }),
    prisma.attachment.findMany({ where: { messageId: { in: messageIds } } }),
  ]);
  const usersById = new Map(users.map((user) => [user.id, user]));
  const repliesById = new Map(replies.map((reply) => [reply.id, reply]));
  const receiptsByMessage = new Map<string, Array<Omit<(typeof receipts)[number], 'messageId'>>>();
  const attachmentsByMessage = new Map<string, typeof attachments>();
  for (const { messageId, ...receipt } of receipts) {
    const group = receiptsByMessage.get(messageId) ?? [];
    group.push(receipt);
    receiptsByMessage.set(messageId, group);
  }
  for (const attachment of attachments) {
    const group = attachmentsByMessage.get(attachment.messageId) ?? [];
    group.push(attachment);
    attachmentsByMessage.set(attachment.messageId, group);
  }
  return {
    messages: page
      .map((message) => {
        const reply = message.replyToMessageId
          ? repliesById.get(message.replyToMessageId)
          : undefined;
        return {
          ...message,
          sender: message.senderId ? (usersById.get(message.senderId) ?? null) : null,
          replyTo: reply
            ? {
                id: reply.id,
                content: reply.content,
                sender: reply.senderId ? (usersById.get(reply.senderId) ?? null) : null,
              }
            : null,
          receipts: receiptsByMessage.get(message.id) ?? [],
          attachments: attachmentsByMessage.get(message.id) ?? [],
        };
      })
      .reverse(),
    nextCursor,
  };
}

export async function createMessage(conversationId: string, senderId: string, input: MessageInput) {
  await requireMember(conversationId, senderId);
  if (input.replyToMessageId) {
    const reply = await prisma.message.findFirst({
      where: { id: input.replyToMessageId, conversationId },
      select: { id: true },
    });
    if (!reply)
      throw new AppError(400, 'INVALID_REPLY', 'Reply target is not in this conversation');
  }
  const existing = await prisma.message.findUnique({
    where: { senderId_clientMessageId: { senderId, clientMessageId: input.clientMessageId } },
    include: messageInclude,
  });
  if (existing) {
    if (existing.conversationId !== conversationId)
      throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Message ID was already used');
    return existing;
  }
  await validateUploads(senderId, input.attachments ?? []);
  const recipientIds = await prisma.conversationMember.findMany({
    where: { conversationId, userId: { not: senderId } },
    select: { userId: true },
  });
  const persistedId = randomUUID();
  try {
    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: {
          id: persistedId,
          conversationId,
          senderId,
          clientMessageId: input.clientMessageId,
          content: input.content,
          type: input.type,
          replyToMessageId: input.replyToMessageId,
          receipts: { create: recipientIds.map(({ userId }) => ({ userId })) },
          attachments: { create: input.attachments ?? [] },
        },
        include: messageInclude,
      }),
      prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      }),
      ...(env.QUEUE_URL
        ? [
            prisma.outboxJob.create({
              data: {
                payload: { type: 'MESSAGE_CREATED', messageId: persistedId, conversationId },
              },
            }),
          ]
        : []),
    ]);
    return message;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const winner = await prisma.message.findUnique({
        where: { senderId_clientMessageId: { senderId, clientMessageId: input.clientMessageId } },
        include: messageInclude,
      });
      if (winner?.conversationId === conversationId) return winner;
    }
    throw error;
  }
}

export async function editMessage(messageId: string, userId: string, content: string) {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { conversationId: true, senderId: true, deletedAt: true, createdAt: true },
  });
  if (!message) throw new AppError(404, 'MESSAGE_NOT_FOUND', 'Message not found');
  if (message.senderId !== userId)
    throw new AppError(403, 'NOT_MESSAGE_AUTHOR', 'Only the sender can edit this message');
  await requireMember(message.conversationId, userId);
  if (message.deletedAt)
    throw new AppError(409, 'MESSAGE_DELETED', 'Deleted messages cannot be edited');
  if (Date.now() - message.createdAt.getTime() > 15 * 60 * 1000)
    throw new AppError(409, 'EDIT_WINDOW_CLOSED', 'Messages can be edited for 15 minutes');
  return prisma.message.update({
    where: { id: messageId },
    data: { content },
    include: messageInclude,
  });
}

export async function deleteMessage(messageId: string, userId: string) {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { conversationId: true, senderId: true },
  });
  if (!message) throw new AppError(404, 'MESSAGE_NOT_FOUND', 'Message not found');
  if (message.senderId !== userId)
    throw new AppError(403, 'NOT_MESSAGE_AUTHOR', 'Only the sender can delete this message');
  await requireMember(message.conversationId, userId);
  return prisma.message.update({
    where: { id: messageId },
    data: { content: '', deletedAt: new Date(), attachments: { deleteMany: {} } },
    include: messageInclude,
  });
}

export async function markDelivered(messageId: string, userId: string, conversationId: string) {
  await requireMember(conversationId, userId);
  const receipt = await prisma.messageReceipt.findUnique({
    where: { messageId_userId: { messageId, userId } },
    include: { message: { select: { conversationId: true } } },
  });
  if (!receipt || receipt.message.conversationId !== conversationId)
    throw new AppError(403, 'INVALID_RECEIPT', 'No delivery receipt exists for this user');
  return prisma.messageReceipt.update({
    where: { messageId_userId: { messageId, userId } },
    data: { deliveredAt: receipt.deliveredAt ?? new Date() },
  });
}

export async function markRead(conversationId: string, messageId: string, userId: string) {
  await requireMember(conversationId, userId);
  const target = await prisma.message.findFirst({
    where: { id: messageId, conversationId },
    select: { createdAt: true, id: true },
  });
  if (!target) throw new AppError(404, 'MESSAGE_NOT_FOUND', 'Message not found');
  const readAt = new Date();
  await prisma.$transaction([
    prisma.messageReceipt.updateMany({
      where: {
        userId,
        readAt: null,
        message: {
          conversationId,
          OR: [
            { createdAt: { lt: target.createdAt } },
            { createdAt: target.createdAt, id: { lte: target.id } },
          ],
        },
      },
      data: { deliveredAt: readAt, readAt },
    }),
    prisma.$executeRaw`UPDATE "ConversationMember" SET "lastReadMessageId" = ${messageId}::uuid
      WHERE "conversationId" = ${conversationId}::uuid AND "userId" = ${userId}::uuid
      AND ("lastReadMessageId" IS NULL OR
        (SELECT ("createdAt", "id") FROM "Message" WHERE "id" = "ConversationMember"."lastReadMessageId") <
        (SELECT ("createdAt", "id") FROM "Message" WHERE "id" = ${messageId}::uuid))`,
  ]);
  return { conversationId, messageId, userId, readAt };
}
