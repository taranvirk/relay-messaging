import { type MemberRole, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/errors.js';
import { messageInclude, publicUserSelect } from '../utils/selects.js';

const conversationInclude = {
  members: {
    include: { user: { select: publicUserSelect } },
    orderBy: { joinedAt: 'asc' as const },
  },
  messages: {
    where: { deletedAt: null },
    include: messageInclude,
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
  },
} satisfies Prisma.ConversationInclude;

export async function requireMember(conversationId: string, userId: string) {
  const member = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (!member) throw new AppError(403, 'NOT_A_MEMBER', 'You are not a member of this conversation');
  return member;
}

export async function listConversations(userId: string) {
  const conversations = await prisma.conversation.findMany({
    where: { members: { some: { userId } } },
    include: conversationInclude,
    orderBy: { updatedAt: 'desc' },
  });
  const unread = await prisma.$queryRaw<Array<{ conversationId: string; count: bigint }>>`
    SELECT m."conversationId", COUNT(*) AS count FROM "MessageReceipt" r
    JOIN "Message" m ON m.id = r."messageId"
    JOIN "ConversationMember" cm ON cm."conversationId" = m."conversationId" AND cm."userId" = ${userId}::uuid
    WHERE r."userId" = ${userId}::uuid AND r."readAt" IS NULL AND m."deletedAt" IS NULL
    GROUP BY m."conversationId"`;
  const counts = unread.reduce<Record<string, number>>((acc, item) => {
    acc[item.conversationId] = Number(item.count);
    return acc;
  }, {});
  return conversations.map((conversation) => ({
    ...conversation,
    unreadCount: counts[conversation.id] ?? 0,
  }));
}

export async function createConversation(
  creatorId: string,
  input:
    { type: 'DIRECT'; memberIds: string[] } | { type: 'GROUP'; name: string; memberIds: string[] },
) {
  const uniqueIds = [...new Set(input.memberIds.filter((id) => id !== creatorId))];
  if (input.type === 'DIRECT' && uniqueIds.length !== 1) {
    throw new AppError(
      400,
      'INVALID_DIRECT_MEMBER',
      'Choose one other user for a direct conversation',
    );
  }
  const existingUsers = await prisma.user.count({ where: { id: { in: uniqueIds } } });
  if (existingUsers !== uniqueIds.length)
    throw new AppError(400, 'INVALID_MEMBERS', 'One or more users do not exist');
  if (input.type === 'DIRECT') {
    const directKey = [creatorId, uniqueIds[0]].sort().join(':');
    const existing = await prisma.conversation.findUnique({
      where: { directKey },
      include: conversationInclude,
    });
    if (existing) return existing;
    try {
      return await prisma.conversation.create({
        data: {
          type: 'DIRECT',
          directKey,
          createdById: creatorId,
          members: {
            create: [
              { userId: creatorId, role: 'MEMBER' },
              { userId: uniqueIds[0]!, role: 'MEMBER' },
            ],
          },
        },
        include: conversationInclude,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await prisma.conversation.findUnique({
          where: { directKey },
          include: conversationInclude,
        });
        if (winner) return winner;
      }
      throw error;
    }
  }
  return prisma.conversation.create({
    data: {
      type: 'GROUP',
      name: input.name,
      createdById: creatorId,
      members: {
        create: [
          { userId: creatorId, role: 'OWNER' },
          ...uniqueIds.map((userId) => ({ userId, role: 'MEMBER' as const })),
        ],
      },
      messages: { create: { content: 'Group created', type: 'SYSTEM' } },
    },
    include: conversationInclude,
  });
}

export async function getConversation(conversationId: string, userId: string) {
  await requireMember(conversationId, userId);
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: conversationInclude,
  });
  if (!conversation) throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
  return conversation;
}

async function requireManager(conversationId: string, userId: string) {
  const member = await requireMember(conversationId, userId);
  if (!['OWNER', 'ADMIN'].includes(member.role))
    throw new AppError(403, 'INSUFFICIENT_ROLE', 'Owner or admin role required');
  return member;
}

export async function updateConversation(conversationId: string, userId: string, name: string) {
  await requireManager(conversationId, userId);
  return prisma.conversation.update({
    where: { id: conversationId, type: 'GROUP' },
    data: { name },
    include: conversationInclude,
  });
}

export async function deleteConversation(conversationId: string, userId: string) {
  const member = await requireMember(conversationId, userId);
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { type: true },
  });
  if (!conversation) throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
  if (conversation.type === 'GROUP' && member.role !== 'OWNER') {
    throw new AppError(403, 'OWNER_REQUIRED', 'Only the owner can delete a group');
  }
  await prisma.conversation.delete({ where: { id: conversationId } });
}

export async function addMember(
  conversationId: string,
  actorId: string,
  userId: string,
  role: MemberRole,
) {
  const manager = await requireManager(conversationId, actorId);
  if (role === 'ADMIN' && manager.role !== 'OWNER')
    throw new AppError(403, 'OWNER_REQUIRED', 'Only the owner can appoint an admin');
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { type: true },
  });
  if (conversation?.type !== 'GROUP')
    throw new AppError(400, 'GROUP_ONLY', 'Members can only be managed in groups');
  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    select: { displayName: true },
  });
  const added = await prisma.user.findUnique({
    where: { id: userId },
    select: { displayName: true },
  });
  if (!added) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  await prisma.$transaction([
    prisma.conversationMember.create({
      data: { conversationId, userId, role: role === 'ADMIN' ? 'ADMIN' : 'MEMBER' },
    }),
    prisma.message.create({
      data: {
        conversationId,
        type: 'SYSTEM',
        content: `${actor?.displayName ?? 'A member'} added ${added.displayName}`,
      },
    }),
  ]);
  return getConversation(conversationId, actorId);
}

export async function removeMember(conversationId: string, actorId: string, targetId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { type: true },
  });
  if (conversation?.type !== 'GROUP')
    throw new AppError(400, 'GROUP_ONLY', 'Only groups support leaving or removing members');
  const actor = await requireMember(conversationId, actorId);
  const target = await requireMember(conversationId, targetId);
  if (targetId !== actorId) {
    if (!['OWNER', 'ADMIN'].includes(actor.role))
      throw new AppError(403, 'INSUFFICIENT_ROLE', 'You cannot remove other members');
    if (target.role === 'OWNER' || (target.role === 'ADMIN' && actor.role !== 'OWNER')) {
      throw new AppError(403, 'ROLE_HIERARCHY', 'You cannot remove a member with this role');
    }
  }
  if (target.role === 'OWNER')
    throw new AppError(409, 'TRANSFER_OWNERSHIP', 'Transfer ownership before leaving');
  const user = await prisma.user.findUnique({
    where: { id: targetId },
    select: { displayName: true },
  });
  await prisma.$transaction([
    prisma.conversationMember.delete({
      where: { conversationId_userId: { conversationId, userId: targetId } },
    }),
    prisma.message.create({
      data: {
        conversationId,
        type: 'SYSTEM',
        content: `${user?.displayName ?? 'A member'} left the group`,
      },
    }),
  ]);
}

export async function transferOwnership(conversationId: string, actorId: string, targetId: string) {
  const actor = await requireMember(conversationId, actorId);
  await requireMember(conversationId, targetId);
  if (actor.role !== 'OWNER' || targetId === actorId)
    throw new AppError(403, 'OWNER_REQUIRED', 'Choose another member to receive ownership');
  await prisma.$transaction(
    async (transaction) => {
      const changed = await transaction.conversationMember.updateMany({
        where: { conversationId, userId: actorId, role: 'OWNER' },
        data: { role: 'ADMIN' },
      });
      if (changed.count !== 1)
        throw new AppError(409, 'OWNERSHIP_CHANGED', 'Group ownership has already changed');
      await transaction.conversationMember.update({
        where: { conversationId_userId: { conversationId, userId: targetId } },
        data: { role: 'OWNER' },
      });
      await transaction.message.create({
        data: { conversationId, type: 'SYSTEM', content: 'Group ownership transferred' },
      });
    },
    { timeout: 15_000 },
  );
  return getConversation(conversationId, actorId);
}
