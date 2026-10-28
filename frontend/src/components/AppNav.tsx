import { LogOut, MessageSquare, Settings, UserRound } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Avatar } from './Avatar';
import { Brand } from './Brand';
import { toast } from 'sonner';
import { replaceWithLogin } from '../lib/navigation';

export function AppNav() {
  const { user, logout } = useAuth();
  if (!user) return null;
  const items = [
    ['/messages', MessageSquare, 'Messages'],
    ['/profile', UserRound, 'Profile'],
    ['/settings', Settings, 'Settings'],
  ] as const;
  return (
    <aside className="flex h-16 items-center border-b border-white/10 bg-[#0c121a] px-4 lg:h-screen lg:w-[84px] lg:flex-col lg:border-b-0 lg:border-r lg:px-0 lg:py-5">
      <div className="lg:hidden">
        <Brand />
      </div>
      <span className="hidden h-10 w-10 place-items-center rounded-xl bg-signal text-ink lg:grid">
        <MessageSquare size={20} />
      </span>
      <nav
        aria-label="Primary"
        className="ml-auto flex items-center gap-1 lg:ml-0 lg:mt-12 lg:flex-col lg:gap-3"
      >
        {items.map(([href, Icon, label]) => (
          <NavLink
            key={href}
            to={href}
            title={label}
            className={({ isActive }) =>
              `grid h-11 w-11 place-items-center rounded-xl transition ${isActive ? 'bg-white/10 text-signal' : 'text-mist hover:bg-white/[0.05] hover:text-white'}`
            }
          >
            <Icon size={20} />
            <span className="sr-only">{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="ml-2 flex items-center gap-2 lg:ml-0 lg:mt-auto lg:flex-col">
        <Avatar user={user} size="sm" />
        <button
          title="Log out"
          onClick={() =>
            void logout()
              .then(replaceWithLogin)
              .catch((error: Error) => toast.error(error.message))
          }
          className="grid h-10 w-10 place-items-center rounded-xl text-mist hover:bg-white/[0.05] hover:text-white"
        >
          <LogOut size={18} />
          <span className="sr-only">Log out</span>
        </button>
      </div>
    </aside>
  );
}
