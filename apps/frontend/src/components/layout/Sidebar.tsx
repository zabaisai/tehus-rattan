'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  KanbanSquare,
  MessageSquare,
  CheckSquare,
  MessageCircle,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';

export function Sidebar() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const canManageWhatsApp =
    user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  const navItems = [
    { href: '/dashboard', label: 'Inicio', icon: LayoutDashboard },
    { href: '/dashboard/contacts', label: 'Contactos', icon: Users },
    { href: '/dashboard/pipeline', label: 'Pipeline', icon: KanbanSquare },
    { href: '/dashboard/conversations', label: 'Conversaciones', icon: MessageSquare },
    { href: '/dashboard/tasks', label: 'Tareas', icon: CheckSquare },
    ...(canManageWhatsApp
      ? [{ href: '/dashboard/settings/whatsapp', label: 'WhatsApp', icon: MessageCircle }]
      : []),
  ];

  return (
    <aside className="flex h-full w-60 flex-col border-r border-stone-200 bg-white">
      <div className="border-b border-stone-200 px-5 py-4">
        <h1 className="text-sm font-semibold tracking-tight text-stone-900">
          Tehus Rattan
        </h1>
        <p className="text-xs text-stone-500">CRM</p>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-4">
        {navItems.map((item) => {
          const isActive =
            item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${
                isActive
                  ? 'bg-stone-900 text-white'
                  : 'text-stone-600 hover:bg-stone-100'
              }`}
            >
              <Icon size={16} strokeWidth={2} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}