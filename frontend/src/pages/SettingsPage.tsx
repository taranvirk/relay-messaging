import { useState } from 'react';
import { Bell, Moon, ShieldCheck, Volume2 } from 'lucide-react';
import { AppNav } from '../components/AppNav';

export function SettingsPage() {
  const [sounds, setSounds] = useState(() => localStorage.getItem('relay:sounds') !== 'off');
  const [notifications, setNotifications] = useState(
    () => localStorage.getItem('relay:notifications') === 'on',
  );
  const setPreference = async (key: string, value: boolean, setter: (value: boolean) => void) => {
    if (key === 'relay:notifications' && value)
      value = 'Notification' in window && (await Notification.requestPermission()) === 'granted';
    setter(value);
    localStorage.setItem(key, value ? 'on' : 'off');
  };
  return (
    <main className="flex min-h-screen bg-ink text-white">
      <AppNav />
      <section className="w-full pt-16 lg:pt-0">
        <div className="mx-auto max-w-3xl px-6 py-10 sm:py-16">
          <p className="font-mono text-xs uppercase tracking-[.22em] text-signal">Preferences</p>
          <h1 className="mt-2 font-display text-3xl font-bold">Settings</h1>
          <p className="mt-2 text-mist">Tune the signal without losing the thread.</p>
          <div className="mt-10 overflow-hidden rounded-2xl border border-white/10 bg-panel shadow-signal">
            <Setting
              icon={Volume2}
              title="Message sounds"
              description="Play a subtle sound for new messages."
              value={sounds}
              onChange={(value) => {
                void setPreference('relay:sounds', value, setSounds);
              }}
            />
            <Setting
              icon={Bell}
              title="Desktop notifications"
              description="Show notifications when Relay is in the background."
              value={notifications}
              onChange={(value) => {
                void setPreference('relay:notifications', value, setNotifications);
              }}
            />
            <div className="flex gap-4 border-t border-white/10 p-5 sm:p-6">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.05] text-signal">
                <Moon size={19} />
              </span>
              <div>
                <h2 className="font-semibold">Appearance</h2>
                <p className="mt-1 text-sm leading-6 text-mist">
                  Relay uses its low-glare dark workspace everywhere.
                </p>
              </div>
            </div>
            <div className="flex gap-4 border-t border-white/10 p-5 sm:p-6">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.05] text-signal">
                <ShieldCheck size={19} />
              </span>
              <div>
                <h2 className="font-semibold">Session security</h2>
                <p className="mt-1 text-sm leading-6 text-mist">
                  Your sign-in uses a signed, HTTP-only session cookie. Logging out revokes that
                  session on every replica.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function Setting({
  icon: Icon,
  title,
  description,
  value,
  onChange,
}: {
  icon: typeof Bell;
  title: string;
  description: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-4 border-t border-white/10 p-5 first:border-t-0 sm:p-6">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.05] text-signal">
        <Icon size={19} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-mist">{description}</p>
      </div>
      <button
        role="switch"
        aria-checked={value}
        aria-label={title}
        onClick={() => onChange(!value)}
        className={`relative h-7 w-12 rounded-full transition ${value ? 'bg-signal' : 'bg-[#344151]'}`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${value ? 'left-6' : 'left-1'}`}
        />
      </button>
    </div>
  );
}
