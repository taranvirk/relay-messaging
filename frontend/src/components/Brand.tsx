import { Radio } from 'lucide-react';

export function Brand() {
  return (
    <div className="flex items-center gap-3 font-display text-xl font-bold tracking-tight text-white">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-signal text-ink">
        <Radio size={20} strokeWidth={2.5} />
      </span>
      Relay
    </div>
  );
}
