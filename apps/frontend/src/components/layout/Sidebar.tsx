'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, X } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { useDialogoModal } from '@/components/ui/useDialogoModal';
import { iniciales } from '@/components/ui/Avatar';
import { TaktoLogo } from '@/components/ui/TaktoLogo';
import { getMyCompany, resolveCompanyAssetUrl } from '@/lib/companies';
import { NAV_ITEMS, PLATFORM_NAV_ITEMS, visibleNavItems } from '@/lib/navigation';
import { useTenantCapabilities } from '@/lib/tenant-capabilities';

interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const cajonRef = useRef<HTMLDivElement>(null);
  const user = useAuthStore((s) => s.user);
  const canManageCompany =
    user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
  const isPlatformSuperAdmin =
    user?.role === 'SUPER_ADMIN' && user?.companyId === null;

  // Los módulos opcionales (Tareas, Catálogo, Cotizaciones) solo aparecen
  // cuando la configuración de la empresa es conocida Y los tiene activos.
  // Mientras carga, o si falla, simplemente no están: la navegación central
  // sigue entera y nada parpadea.
  const capacidades = useTenantCapabilities();

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

  // El cajón se queda montado para que la transición pueda animarse, así que
  // abierto y cerrado son estados del MISMO elemento. Ver el `inert` de abajo.
  useDialogoModal({
    activo: mobileOpen,
    onCerrar: onMobileClose,
    refPanel: cajonRef,
  });

  // A global SUPER_ADMIN administers the platform, not a company's CRM —
  // it never gets the normal business nav, only the Plataforma section.
  // La tabla de enlaces y sus reglas (rol + módulo) viven en `lib/navigation`.
  const navItems = isPlatformSuperAdmin
    ? []
    : visibleNavItems(NAV_ITEMS, {
        role: user?.role,
        can: capacidades.can,
        isReady: capacidades.isReady,
      });

  const logoUrl = company?.logoUrl ? resolveCompanyAssetUrl(company.logoUrl) : null;
  const brandName = company?.name || 'TAKTO';

  /**
   * LAS DOS MARCAS, SEPARADAS EN VEZ DE MEZCLADAS.
   *
   * El manual prohibe mezclar la identidad de TAKTO con la de la empresa
   * cliente, y antes eso se resolvia enseñando SOLO a la empresa: la barra no
   * decia de que producto era. El mockup 01 lo resuelve mejor y es lo que se
   * implementa aqui: TAKTO arriba, como marca del producto en su propia
   * franja, y la empresa justo debajo en su propio bloque. Nunca comparten
   * linea, nunca comparten fondo, y el color propio de la empresa no se
   * derrama sobre la navegacion.
   *
   * Por eso el color primario de la empresa YA NO pinta el elemento activo del
   * menu: el elemento activo pertenece al producto, no al inquilino. La
   * identidad de la empresa vive en su bloque, en sus documentos y en sus
   * pantallas.
   */
  const bloqueDeEmpresa = (compacto = false) => {
    const contenido = (
      <>
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            className="h-7 w-7 shrink-0 rounded-md bg-white object-contain p-0.5"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/10 text-[11px] font-semibold text-white"
          >
            {iniciales(brandName)}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">
          {brandName}
        </span>
        {canManageCompany && (
          <ChevronRight
            size={15}
            aria-hidden="true"
            className="shrink-0 text-white/50 transition-transform duration-rapida ease-standard group-hover:translate-x-0.5"
          />
        )}
      </>
    );

    // El chevron solo aparece si de verdad lleva a algun sitio. Un desplegable
    // dibujado que no despliega nada es peor que no dibujarlo: un usuario
    // pertenece a UNA empresa, asi que aqui no hay nada entre lo que elegir.
    // Para quien administra, el bloque abre la configuracion de su empresa.
    return canManageCompany ? (
      <Link
        href="/dashboard/settings/company"
        className={`group flex items-center gap-2.5 rounded-lg bg-white/5 outline-none transition-colors duration-rapida ease-standard hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-brand-secondary ${
          compacto ? 'px-2.5 py-2' : 'px-3 py-2.5'
        }`}
      >
        {contenido}
      </Link>
    ) : (
      <div
        className={`flex items-center gap-2.5 rounded-lg bg-white/5 ${
          compacto ? 'px-2.5 py-2' : 'px-3 py-2.5'
        }`}
      >
        {contenido}
      </div>
    );
  };

  function renderNav(onNavigate?: () => void) {
    return (
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        {/* Solo para lector de pantalla: avisa de que faltan entradas por
            llegar. Visualmente no hay hueco que rellenar, porque un módulo
            prohibido no debe ocupar sitio ni un instante. */}
        {!isPlatformSuperAdmin && capacidades.status === 'loading' && (
          <span role="status" aria-live="polite" className="sr-only">
            Cargando módulos…
          </span>
        )}
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
              aria-current={isActive ? 'page' : undefined}
              // El acento naranja marca DONDE ESTAS: una barra a la izquierda
              // del elemento activo. Va como borde y no como fondo porque el
              // naranja a pantalla completa compite con el contenido.
              className={`flex items-center gap-2.5 rounded-md border-l-2 px-2.5 py-2.5 text-sm transition-colors duration-rapida ease-standard sm:py-2 ${
                isActive
                  ? 'border-brand-secondary bg-white/10 font-medium text-white'
                  : 'border-transparent text-neutral-300 hover:bg-white/5 hover:text-white'
              }`}
            >
              <Icon size={16} strokeWidth={2} className="shrink-0" />
              {item.label}
            </Link>
          );
        })}

        {isPlatformSuperAdmin && (
          <>
            <div className="mb-1 mt-4 px-2.5 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Plataforma
            </div>
            {PLATFORM_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex items-center gap-2.5 rounded-md border-l-2 px-2.5 py-2.5 text-sm transition-colors duration-rapida ease-standard sm:py-2 ${
                    isActive
                      ? 'border-brand-secondary bg-white/10 font-medium text-white'
                      : 'border-transparent text-neutral-300 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <Icon size={16} strokeWidth={2} className="shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </>
        )}
      </nav>
    );
  }

  return (
    <>
      {/* Desktop: fixed sidebar, always visible from the lg breakpoint up. */}
      <aside className="hidden h-full w-60 shrink-0 flex-col bg-surface-inverse lg:flex">
        <div className="flex shrink-0 items-center px-5 py-4">
          {/* TAKTO en negativo: TAK blanco, TO naranja. Es la regla del manual
              para fondo oscuro, y la geometria aprobada vive en el propio
              componente, no redibujada aqui. */}
          <Link
            href="/dashboard"
            aria-label="TAKTO — ir al inicio"
            className="rounded outline-none focus-visible:ring-2 focus-visible:ring-brand-secondary"
          >
            <TaktoLogo variant="lockup" tone="negative" height={26} />
          </Link>
        </div>
        {!isPlatformSuperAdmin && (
          <div className="shrink-0 px-3 pb-3">{bloqueDeEmpresa()}</div>
        )}
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
        {/* CERRADO NO ES INVISIBLE.
            El cajón se queda montado para poder animar la entrada, y así
            estaba: `display:flex`, `visibility:visible`, sin `aria-hidden` y
            con catorce enlaces enfocables fuera de pantalla. En móvil, con el
            menú cerrado, bastaban DOS tabulaciones para caer dentro de un menú
            que no se ve.

            `inert` lo saca del orden de tabulación Y del árbol de
            accesibilidad sin tocar la transición. `role`/`aria-modal` solo se
            declaran cuando de verdad hay un diálogo: anunciarlo siempre le
            decía al lector de pantalla que el resto de la página no existe. */}
        <div
          ref={cajonRef}
          {...(mobileOpen
            ? {
                role: 'dialog' as const,
                'aria-modal': true,
                'aria-label': 'Navegación principal',
              }
            : { inert: true })}
          className={`fixed inset-y-0 left-0 z-50 flex h-full w-72 max-w-[85vw] flex-col bg-surface-inverse shadow-xl transition-transform duration-lenta ease-standard ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="flex shrink-0 items-center justify-between px-4 py-3">
            <TaktoLogo variant="lockup" tone="negative" height={24} />
            <button
              type="button"
              onClick={onMobileClose}
              aria-label="Cerrar menú"
              className="rounded-md p-1.5 text-white/70 transition-colors duration-rapida ease-standard hover:bg-white/10 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>
          {!isPlatformSuperAdmin && (
            <div className="shrink-0 px-3 pb-3">{bloqueDeEmpresa(true)}</div>
          )}
          {renderNav(onMobileClose)}
        </div>
      </div>
    </>
  );
}
