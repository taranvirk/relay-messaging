import type { Conversation, User } from '../types';

export function conversationName(conversation: Conversation, currentUserId: string): string {
  if (conversation.type === 'GROUP') return conversation.name ?? 'Untitled group';
  return (
    conversation.members.find((member) => member.userId !== currentUserId)?.user.displayName ??
    'Direct message'
  );
}

export function initials(user: Pick<User, 'displayName'>): string {
  return user.displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function messageTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(value),
  );
}

export function relativeTime(value: string | null): string {
  if (!value) return 'Offline';
  const minutes = Math.round((new Date(value).getTime() - Date.now()) / 60_000);
  if (Math.abs(minutes) < 1) return 'Just now';
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(minutes, 'minute');
}
