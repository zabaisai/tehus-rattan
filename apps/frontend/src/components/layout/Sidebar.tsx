'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Users,
  KanbanSquare,
  MessageSquare,
  CheckSquare,
  MessageCircle,
  Building2,
  ScrollText,
  Package,
  FileText,
  Calculator,
  Settings,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { getMyCompany, resolveCompanyAssetUrl } from '@/lib/companies';

export function Sidebar() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const canManageWhatsApp =
    user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
  const canManageCompany = canManageWhatsApp;
  const isPlatformSuperAdmin =
    user?.role === 'SUPER_ADMIN' && user?.companyId === null;

  // Platform SUPER_ADMINs have no companyId — there is no company profile to
  // fetch or brand the sidebar with for them.
  const { data: company } = useQuery({
    queryKey: ['company-me'],
    queryFn: getMyCompany,
    enabled: !!user && !isPlatformSuperAdmin,
  });

  const platformNavItems = [
    { href: '/dashboard/platform/companies', label: 'Empresas', icon: Building2 },
    { href: '/dashboard/platform/audit-logs', label: 'Auditoría', icon: ScrollText },
  ];

  // A global SUPER_ADMIN administers the platform, not a company's CRM —
  // it never gets the normal business nav, only the Plataforma section.
  const navItems = isPlatformSuperAdmin
    ? []
    : [
        { href: '/dashboard', label: 'Inicio', icon: LayoutDashboard },
        { href: '/dashboard/contacts', label: 'Contactos', icon: Users },
        { href: '/dashboard/pipeline', label: 'Pipeline', icon: KanbanSquare },
        { href: '/dashboard/conversations', label: 'Conversaciones', icon: MessageSquare },
        { href: '/dashboard/tasks', label: 'Tareas', icon: CheckSquare },
        { href: '/dashboard/products', label: 'Productos', icon: Package },
        { href: '/dashboard/quotes', label: 'Cotizaciones', icon: FileText },
        { href: '/dashboard/documents/calculator', label: 'Documentos', icon: Calculator },
        ...(canManageWhatsApp
          ? [{ href: '/dashboard/settings/whatsapp', label: 'WhatsApp', icon: MessageCircle }]
          : []),
        ...(canManageCompany
          ? [{ href: '/dashboard/settings/company', label: 'Empresa', icon: Settings }]
          : []),
      ];

  const logoUrl = company?.logoUrl ? resolveCompanyAssetUrl(company.logoUrl) : null;
  const brandName = company?.name || 'Tehus Rattan';
  const activeColor = company?.primaryColor || undefined;

  return (
    <aside className="flex h-full w-60 flex-col border-r border-stone-200 bg-white">
      <div className="flex items-center gap-2.5 border-b border-stone-200 px-5 py-4">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={brandName} className="h-8 w-8 shrink-0 rounded object-contain" />
        ) : null}
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold tracking-tight text-stone-900">
            {brandName}
          </h1>
          <p className="text-xs text-stone-500">CRM</p>
        </div>
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
              style={isActive && activeColor ? { backgroundColor: activeColor } : undefined}
              className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${
                isActive
                  ? `text-white ${activeColor ? '' : 'bg-stone-900'}`
                  : 'text-stone-600 hover:bg-stone-100'
              }`}
            >
              <Icon size={16} strokeWidth={2} />
              {item.label}
            </Link>
          );
        })}

        {isPlatformSuperAdmin && (
          <>
            <div className="mb-1 mt-4 px-2.5 text-xs font-semibold uppercase tracking-wide text-stone-400">
              Plataforma
            </div>
            {platformNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${
                    pathname.startsWith(item.href)
                      ? 'bg-stone-900 text-white'
                      : 'text-stone-600 hover:bg-stone-100'
                  }`}
                >
                  <Icon size={16} strokeWidth={2} />
                  {item.label}
                </Link>
              );
            })}
          </>
        )}
      </nav>
    </aside>
  );
}