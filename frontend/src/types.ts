export type User = {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  avatarUrl: string | null;
  lastSeenAt: string | null;
  createdAt: string;
};

export type Receipt = { userId: string; deliveredAt: string | null; readAt: string | null };

export type Message = {
  id: string;
  conversationId: string;
  senderId: string | null;
  clientMessageId: string | null;
  content: string;
  type: 'TEXT' | 'IMAGE' | 'FILE' | 'SYSTEM';
  replyToMessageId: string | null;
  replyTo?: { id: string; content: string; sender: User | null } | null;
  sender: User | null;
  receipts: Receipt[];
  attachments: Array<{ id: string; fileName: string; mimeType: string; fileSize: number }>;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type Member = { id: string; userId: string; role: 'OWNER' | 'ADMIN' | 'MEMBER'; user: User };

export type Conversation = {
  id: string;
  type: 'DIRECT' | 'GROUP';
  name: string | null;
  members: Member[];
  messages: Message[];
  unreadCount: number;
  updatedAt: string;
};

export type ApiError = { error: { code: string; message: string } };
