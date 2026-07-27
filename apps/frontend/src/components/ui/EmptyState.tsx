import { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon;
  message: string;
  action?: React.ReactNode;
}

/** Shared empty-state block: icon + message + optional next action, never a blank screen. */
export function EmptyState({ icon: Icon, message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-stone-300 bg-white py-14 text-stone-400">
      {Icon && <Icon size={28} strokeWidth={1.5} />}
      <p className="text-sm">{message}</p>
      {action}
    </div>
  );
}
