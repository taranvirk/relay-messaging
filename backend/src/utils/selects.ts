import type { Prisma } from '@prisma/client';

export const publicUserSelect = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  lastSeenAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export const messageInclude = {
  sender: { select: publicUserSelect },
  replyTo: { select: { id: true, content: true, sender: { select: publicUserSelect } } },
  receipts: { select: { userId: true, deliveredAt: true, readAt: true } },
  attachments: true,
} satisfies Prisma.MessageInclude;
