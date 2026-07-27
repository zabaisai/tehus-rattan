import {
  Bell,
  Building2,
  CheckSquare,
  FileText,
  MessageCircle,
  MessageSquare,
  ShieldAlert,
  Target,
  UserPlus,
  Smartphone,
} from 'lucide-react';
import type { NotificationCategory } from '@/lib/notifications';

const ICONS: Record<NotificationCategory, typeof Bell> = {
  CONVERSATION: MessageSquare,
  MESSAGE: MessageCircle,
  CONTACT: UserPlus,
  LEAD: Target,
  TASK: CheckSquare,
  QUOTE: FileText,
  WHATSAPP: Smartphone,
  SECURITY: ShieldAlert,
  PLATFORM: Building2,
  SYSTEM: Bell,
};

export function CategoryIcon({
  category,
  size = 16,
}: {
  category: NotificationCategory;
  size?: number;
}) {
  const Icon = ICONS[category] ?? Bell;
  return <Icon size={size} aria-hidden />;
}

// Compact relative time in Spanish. Falls back to a locale date for old items.
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return 'hace un momento';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `hace ${days} d`;
  return new Date(iso).toLocaleDateString('es-CO');
}
