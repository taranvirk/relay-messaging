import { z } from 'zod';

export const attachmentSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain']),
  fileSize: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024),
  storageKey: z.string().min(1).max(500),
});

export const createMessageSchema = z.object({
  clientMessageId: z.string().min(1).max(100),
  content: z.string().trim().min(1).max(10_000),
  type: z.enum(['TEXT', 'IMAGE', 'FILE']).default('TEXT'),
  replyToMessageId: z.string().uuid().nullable().optional(),
  attachments: z.array(attachmentSchema).max(5).default([]),
});

export const socketMessageSchema = createMessageSchema.extend({
  conversationId: z.string().uuid(),
});
export const editMessageSchema = z.object({ content: z.string().trim().min(1).max(10_000) });
export const socketEditMessageSchema = editMessageSchema.extend({ messageId: z.string().uuid() });
export const socketDeleteMessageSchema = z.object({ messageId: z.string().uuid() });
export const receiptSchema = z.object({
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
});
export const typingSchema = z.object({ conversationId: z.string().uuid() });

export const paginationSchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
