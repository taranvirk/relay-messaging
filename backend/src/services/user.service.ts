import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/errors.js';
import { publicUserSelect } from '../utils/selects.js';

export async function searchUsers(userId: string, query: string) {
  if (query.trim().length < 2) return [];
  return prisma.user.findMany({
    where: {
      id: { not: userId },
      OR: [
        { username: { contains: query, mode: 'insensitive' } },
        { displayName: { contains: query, mode: 'insensitive' } },
      ],
    },
    select: publicUserSelect,
    take: 20,
    orderBy: { displayName: 'asc' },
  });
}

export async function getUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: publicUserSelect });
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  return user;
}

export async function updateUser(
  userId: string,
  input: { displayName?: string; username?: string; avatarUrl?: string | null },
) {
  return prisma.user.update({
    where: { id: userId },
    data: { ...input, username: input.username?.toLowerCase() },
    select: { ...publicUserSelect, email: true },
  });
}
