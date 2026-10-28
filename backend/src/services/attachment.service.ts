import { randomUUID } from 'node:crypto';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { requireMember } from './conversation.service.js';

const s3 = new S3Client({ region: env.AWS_REGION });

function bucket(): string {
  if (!env.ATTACHMENTS_BUCKET)
    throw new AppError(503, 'ATTACHMENTS_DISABLED', 'Attachments are not configured');
  return env.ATTACHMENTS_BUCKET;
}

export async function createUploadUrl(
  userId: string,
  fileName: string,
  mimeType: string,
  fileSize: number,
) {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storageKey = `users/${userId}/${randomUUID()}-${safeName}`;
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: bucket(),
      Key: storageKey,
      ContentType: mimeType,
      ContentLength: fileSize,
    }),
    { expiresIn: 300 },
  );
  return { uploadUrl, storageKey, expiresIn: 300 };
}

export async function createDownloadUrl(attachmentId: string, userId: string) {
  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    include: { message: { select: { conversationId: true } } },
  });
  if (!attachment) throw new AppError(404, 'ATTACHMENT_NOT_FOUND', 'Attachment not found');
  await requireMember(attachment.message.conversationId, userId);
  const downloadUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucket(),
      Key: attachment.storageKey,
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
    }),
    { expiresIn: 300 },
  );
  return { downloadUrl, expiresIn: 300 };
}

export async function validateUploads(
  userId: string,
  attachments: Array<{ storageKey: string; mimeType: string; fileSize: number }>,
): Promise<void> {
  for (const attachment of attachments) {
    if (!attachment.storageKey.startsWith(`users/${userId}/`))
      throw new AppError(403, 'INVALID_UPLOAD_OWNER', 'This upload does not belong to you');
    const metadata = await s3.send(
      new HeadObjectCommand({ Bucket: bucket(), Key: attachment.storageKey }),
    );
    if (
      metadata.ContentLength !== attachment.fileSize ||
      metadata.ContentType !== attachment.mimeType
    )
      throw new AppError(
        400,
        'UPLOAD_MISMATCH',
        'Uploaded object does not match its declared size or type',
      );
  }
}
