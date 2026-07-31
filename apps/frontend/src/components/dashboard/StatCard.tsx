import { LucideIcon } from 'lucide-react';

export function StatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-neutral-500">{label}</p>
        <Icon size={16} className={accent ?? 'text-neutral-400'} />
      </div>
      <p className="mt-1.5 text-xl font-semibold text-neutral-900">{value}</p>
    </div>
  );
}