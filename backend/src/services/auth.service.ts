import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma.js';
import { AppError } from '../utils/errors.js';
import { publicUserSelect } from '../utils/selects.js';

type RegisterInput = { username: string; displayName: string; email: string; password: string };

export async function registerUser(input: RegisterInput) {
  const email = input.email.toLowerCase();
  const username = input.username.toLowerCase();
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
    select: { id: true },
  });
  if (existing) throw new AppError(409, 'ACCOUNT_EXISTS', 'Email or username is already in use');
  const passwordHash = await bcrypt.hash(input.password, 12);
  return prisma.user.create({
    data: { email, username, displayName: input.displayName, passwordHash },
    select: publicUserSelect,
  });
}

export async function authenticateUser(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    avatarUrl: user.avatarUrl,
    lastSeenAt: user.lastSeenAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function getCurrentUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { ...publicUserSelect, email: true },
  });
  if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'Account no longer exists');
  return user;
}
