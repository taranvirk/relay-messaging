import { z } from 'zod';

export const createConversationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('DIRECT'), memberIds: z.array(z.string().uuid()).length(1) }),
  z.object({
    type: z.literal('GROUP'),
    name: z.string().trim().min(1).max(100),
    memberIds: z.array(z.string().uuid()).min(1).max(99),
  }),
]);

export const updateConversationSchema = z.object({ name: z.string().trim().min(1).max(100) });
export const memberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER'),
});
