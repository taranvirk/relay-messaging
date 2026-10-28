import { initials } from '../lib/format';
import type { User } from '../types';

export function Avatar({
  user,
  size = 'md',
}: {
  user: Pick<User, 'displayName' | 'avatarUrl'>;
  size?: 'sm' | 'md' | 'lg';
}) {
  const classes =
    size === 'sm' ? 'h-8 w-8 text-xs' : size === 'lg' ? 'h-14 w-14 text-lg' : 'h-10 w-10 text-sm';
  return user.avatarUrl ? (
    <img src={user.avatarUrl} alt="" className={`${classes} rounded-xl object-cover`} />
  ) : (
    <span
      aria-hidden="true"
      className={`${classes} grid shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.06] font-display font-bold text-signal`}
    >
      {initials(user)}
    </span>
  );
}
