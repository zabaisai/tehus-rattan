'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { AuthGate } from '@/components/auth/AuthGate';
import { TenantCapabilitiesProvider } from '@/lib/tenant-capabilities';
import { useAuthStore } from '@/store/auth.store';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // AuthGate waits for the client-side bootstrap: it only renders the shell
  // once the session is confirmed authenticated (otherwise a loader, or a
  // redirect to /login for anonymous). No token is read from storage here.
  // Las capacidades de la empresa (Fase 4) se resuelven UNA vez para todo el
  // shell: barra lateral, menú «Crear», buscador, Inicio y guardas de ruta
  // leen el mismo estado. El proveedor se desactiva solo para el SUPER_ADMIN
  // de plataforma, que no tiene empresa.
  return (
    <AuthGate>
      <TenantCapabilitiesProvider>
        <DashboardShell>{children}</DashboardShell>
      </TenantCapabilitiesProvider>
    </AuthGate>
  );
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const isPlatformSuperAdmin =
    user?.role === 'SUPER_ADMIN' && user?.companyId === null;
  const isOnPlatformRoute = pathname.startsWith('/dashboard/platform');

  useEffect(() => {
    // A global SUPER_ADMIN has no companyId, so every normal CRM page fires
    // business queries that assume a real company and 500 silently. Keep them
    // confined to /dashboard/platform/* instead of letting those pages mount.
    if (isPlatformSuperAdmin && !isOnPlatformRoute) {
      router.replace('/dashboard/platform/companies');
    }
  }, [isPlatformSuperAdmin, isOnPlatformRoute, router]);

  if (isPlatformSuperAdmin && !isOnPlatformRoute) {
    return (
      <div className="flex h-dvh items-center justify-center bg-neutral-50">
        <p className="text-sm text-neutral-500">Redirigiendo...</p>
      </div>
    );
  }

  return (
    // `h-dvh` y no `h-screen`: `100vh` es la altura del viewport LARGO, la que
    // habría si las barras dinámicas del navegador estuvieran retraídas. En
    // escritorio ambas miden lo mismo —medido: 695,2 px las dos—, así que este
    // cambio no mueve nada hoy; existe para que el shell no se pase de alto
    // justamente donde `100vh` miente, que es el navegador con barra dinámica.
    <div className="flex h-dvh overflow-hidden bg-neutral-50">
      <Sidebar mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onMenuClick={() => setMobileNavOpen(true)} />
        {/* `relative` NO es decoración: es lo que impide una SEGUNDA barra de
            desplazamiento en el documento.

            Un `overflow` distinto de `visible` solo recorta a un descendiente
            absoluto si el elemento que recorta es además su BLOQUE CONTENEDOR.
            Con `main` en `position: static` no lo era, así que cualquier
            descendiente `position: absolute` resolvía contra el bloque
            contenedor inicial —el viewport—, se quedaba fuera del recorte y su
            posición estática, que cae dentro del contenido ya desplazado,
            pasaba a contar como desbordamiento DEL DOCUMENTO.

            Lo disparaba algo tan inocente como `sr-only`, que es
            `position: absolute`: el `<caption>` de la tabla equivalente de
            «Tendencia de ventas» quedaba a 1083 px y estiraba el documento a
            1083 frente a los 695 del viewport. Resultado medido en 1536 px:
            dos barras verticales y 388 px de blanco por debajo del shell.

            Arreglar solo aquel `<caption>` habría tapado el síntoma y dejado
            la trampa puesta para el siguiente `sr-only`, `absolute` o tooltip
            que entre en cualquier pantalla. Con `relative`, el recorte lo hace
            el mismo elemento que ya es la única zona desplazable. */}
        <main className="relative flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
