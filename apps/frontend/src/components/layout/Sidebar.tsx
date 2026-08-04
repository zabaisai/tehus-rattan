'use client';

import { useEffect } from 'react';
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
  KeyRound,
  ShieldCheck,
  X,
  Zap,
  Workflow,
  Bot,
  Trash2,
  Database,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { getMyCompany, resolveCompanyAssetUrl } from '@/lib/companies';

interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
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

  // Close the mobile drawer whenever the route changes — selecting a link
  // should never leave the overlay open behind the new page.
  useEffect(() => {
    onMobileClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onMobileClose();
    }
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [mobileOpen, onMobileClose]);

  const platformNavItems = [
    { href: '/dashboard/platform/companies', label: 'Empresas', icon: Building2 },
    {
      href: '/dashboard/platform/invitation-codes',
      label: 'Códigos de invitación',
      icon: KeyRound,
    },
    { href: '/dashboard/platform/audit-logs', label: 'Auditoría', icon: ScrollText },
    {
      href: '/dashboard/platform/deletion-requests',
      label: 'Eliminaciones',
      icon: Trash2,
    },
    {
      href: '/dashboard/platform/activity',
      label: 'Actividad y seguridad',
      icon: ShieldCheck,
    },
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
        // FlowBot lo ve TODO el mundo, no solo quien administra: un asesor
        // necesita saber si el bot esta atendiendo a su cliente antes de
        // escribirle encima. Crear, editar y publicar sí quedan restringidos,
        // pero dentro de la pantalla.
        { href: '/dashboard/flowbots', label: 'FlowBot', icon: Workflow },
        { href: '/dashboard/tasks', label: 'Tareas', icon: CheckSquare },
        { href: '/dashboard/products', label: 'Productos', icon: Package },
        { href: '/dashboard/quotes', label: 'Cotizaciones', icon: FileText },
        { href: '/dashboard/documents/calculator', label: 'Documentos', icon: Calculator },
        // Las automatizaciones mandan mensajes reales a clientes reales:
        // solo quien administra la empresa deberia poder tocarlas, igual que
        // la conexion de WhatsApp.
        ...(canManageCompany
          ? [
              {
                href: '/dashboard/automations',
                label: 'Automatizaciones',
                icon: Zap,
              },
              { href: '/dashboard/chatbot', label: 'Chatbot', icon: Bot },
            ]
          : []),
        ...(canManageWhatsApp
          ? [{ href: '/dashboard/settings/whatsapp', label: 'WhatsApp', icon: MessageCircle }]
          : []),
        ...(canManageCompany
          ? [
              { href: '/dashboard/settings/company', label: 'Empresa', icon: Settings },
              // Retención, exportación y solicitud de eliminación. Enlazado y
              // no escondido: una empresa tiene que poder llevarse sus datos
              // sin escribirle a nadie.
              { href: '/dashboard/settings/data', label: 'Datos', icon: Database },
            ]
          : []),
      ];

  const logoUrl = company?.logoUrl ? resolveCompanyAssetUrl(company.logoUrl) : null;
  // Dentro del espacio de trabajo manda la identidad de LA EMPRESA: es su
  // casa. TAKTO solo aparece como respaldo mientras carga o si no hay
  // nombre; mezclar ambas marcas en la misma barra es justo lo que el manual
  // prohibe.
  const brandName = company?.name || 'TAKTO';
  const activeColor = company?.primaryColor || undefined;

  function renderNav(onNavigate?: () => void) {
    return (
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
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
              onClick={onNavigate}
              style={isActive && activeColor ? { backgroundColor: activeColor } : undefined}
              // El acento naranja marca DONDE ESTAS: una barra a la
              // izquierda del elemento activo. Va como borde y no como fondo
              // porque el naranja de marca a pantalla completa compite con el
              // contenido, y porque asi convive con el color propio de cada
              // empresa sin taparlo.
              className={`flex items-center gap-2.5 rounded-md border-l-2 px-2.5 py-2.5 text-sm transition-colors sm:py-2 ${
                isActive
                  ? `border-brand-secondary text-white ${activeColor ? '' : 'bg-brand-primary'}`
                  : 'border-transparent text-neutral-600 hover:bg-neutral-100'
              }`}
            >
              <Icon size={16} strokeWidth={2} />
              {item.label}
            </Link>
          );
        })}

        {isPlatformSuperAdmin && (
          <>
            <div className="mb-1 mt-4 px-2.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Plataforma
            </div>
            {platformNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={`flex items-center gap-2.5 rounded-md px-2.5 py-2.5 text-sm transition-colors sm:py-2 ${
                    pathname.startsWith(item.href)
                      ? 'bg-brand-primary text-white'
                      : 'text-neutral-600 hover:bg-neutral-100'
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
    );
  }

  const brandHeader = (
    <div className="flex shrink-0 items-center gap-2.5 border-b border-neutral-200 px-5 py-4">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={brandName} className="h-8 w-8 shrink-0 rounded object-contain" />
      ) : null}
      <div className="min-w-0">
        <h1 className="truncate text-sm font-semibold tracking-tight text-neutral-900">
          {brandName}
        </h1>
        <p className="text-xs text-neutral-500">CRM</p>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop: fixed sidebar, always visible from the lg breakpoint up. */}
      <aside className="hidden h-full w-60 shrink-0 flex-col border-r border-neutral-200 bg-white lg:flex">
        {brandHeader}
        {renderNav()}
      </aside>

      {/* Mobile: drawer + overlay, hidden above lg. Kept mounted (off-screen)
          so the slide transition can play instead of popping in/out. */}
      <div className={`lg:hidden ${mobileOpen ? '' : 'pointer-events-none'}`}>
        <div
          aria-hidden="true"
          onClick={onMobileClose}
          className={`fixed inset-0 z-40 bg-black/40 transition-opacity ${
            mobileOpen ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Navegación principal"
          className={`fixed inset-y-0 left-0 z-50 flex h-full w-72 max-w-[85vw] flex-col bg-white shadow-xl transition-transform duration-200 ease-out ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-neutral-200 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt={brandName} className="h-7 w-7 shrink-0 rounded object-contain" />
              ) : null}
              <span className="truncate text-sm font-semibold text-neutral-900">{brandName}</span>
            </div>
            <button
              type="button"
              onClick={onMobileClose}
              aria-label="Cerrar menú"
              className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100"
            >
              <X size={18} />
            </button>
          </div>
          {renderNav(onMobileClose)}
        </div>
      </div>
    </>
  );
}
