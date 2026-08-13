'use client';

import Link from 'next/link';
import { FileText, MessageSquare } from 'lucide-react';
import { ACCIONES_RAPIDAS } from '@/lib/creacion-rapida';

/**
 * La franja de bienvenida del mockup 01.
 *
 * EL NOMBRE ES EL DEL USUARIO, NO UN PREFIJO DE PRUEBAS. `primerNombre` corta
 * por el primer espacio, así que «Ana Administradora» saluda «Ana». Los datos
 * de la vista previa llevan el prefijo `PREVIEW_BRANDING_`, y saludar
 * «Buenos días, PREVIEW_BRANDING_Administrador» sería enseñar el andamiaje de
 * QA como si fuera producto. Se limpia AQUÍ, al pintar, y no en la base: los
 * datos son de quien los creó y esta pantalla no los corrige.
 *
 * LAS DOS ACCIONES SON REALES:
 *   · «Abrir conversaciones» va a la bandeja.
 *   · «Nueva cotización» reutiliza la definición de `creacion-rapida`, que ya
 *     resolvió que una cotización pertenece SIEMPRE a una oportunidad
 *     (`POST /quotes/from-lead/:leadId`). Por eso lleva al embudo a elegirla,
 *     con el aviso debajo, en vez de prometer un formulario que no existe.
 *     Duplicar esa decisión aquí habría dejado dos sitios que contradecirse.
 */
const COTIZACION = ACCIONES_RAPIDAS.find((a) => a.accion === 'cotizacion')!;

export function saludo(hora: number): string {
  if (hora < 12) return 'Buenos días';
  if (hora < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

/**
 * El nombre que sirve para saludar.
 *
 * Quita un prefijo de datos de prueba si lo hay y se queda con el primer
 * nombre. Sin nombre utilizable devuelve `null` y el saludo va solo, que es
 * mejor que «Buenos días, ».
 */
export function primerNombre(nombre: string | null | undefined): string | null {
  const limpio = (nombre ?? '')
    .replace(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_/, '')
    .trim();
  if (!limpio) return null;
  const primero = limpio.split(/\s+/)[0];
  return primero || null;
}

export function HeroInicio({
  nombreUsuario,
  nombreEmpresa,
  hora = new Date().getHours(),
}: {
  nombreUsuario: string | null | undefined;
  nombreEmpresa: string | null | undefined;
  hora?: number;
}) {
  const nombre = primerNombre(nombreUsuario);

  return (
    <section
      aria-labelledby="inicio-saludo"
      // El degradado navy es la composición aprobada del mockup. Va con
      // `bg-surface-inverse` de base para que, si el degradado no pinta, el
      // texto blanco siga sobre un fondo oscuro y no sobre blanco.
      className="relative overflow-hidden rounded-xl bg-surface-inverse bg-gradient-to-br from-primary-800 via-primary-900 to-primary-950 px-5 py-6 sm:px-7 sm:py-7"
    >
      {/* Onda decorativa del mockup. `aria-hidden` y sin texto: es textura. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 hidden w-1/2 opacity-40 sm:block"
      >
        <svg viewBox="0 0 400 160" preserveAspectRatio="none" className="h-full w-full">
          <path
            d="M0 120 C 80 60, 140 150, 220 90 S 340 40, 400 80 L400 160 L0 160 Z"
            fill="url(#ondaInicio)"
          />
          <defs>
            <linearGradient id="ondaInicio" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#3b477e" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#131c4a" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>
      </span>

      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h2
            id="inicio-saludo"
            className="truncate text-2xl font-semibold tracking-tight text-white sm:text-[28px]"
          >
            {saludo(hora)}
            {nombre ? `, ${nombre}` : ''}
          </h2>
          <p className="mt-1 truncate text-sm text-white/70">
            {nombreEmpresa
              ? `Tu operación comercial de hoy · ${nombreEmpresa}`
              : 'Tu operación comercial de hoy'}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-start gap-2.5">
          <Link
            href="/dashboard/conversations"
            className="inline-flex items-center gap-2 rounded-lg border border-white/25 px-4 py-2.5 text-sm font-medium text-white outline-none transition-[background-color,border-color] duration-media ease-standard hover:border-white/40 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-primary-900"
          >
            <MessageSquare size={16} aria-hidden="true" />
            Abrir conversaciones
          </Link>

          <span className="flex flex-col items-center gap-1">
            <Link
              href={COTIZACION.ruta!}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-secondary px-4 py-2.5 text-sm font-semibold text-brand-primary outline-none transition-[background-color] duration-media ease-standard hover:bg-secondary-600 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-primary-900"
            >
              <FileText size={16} aria-hidden="true" />
              {COTIZACION.etiqueta}
            </Link>
            {/* El mismo aviso que da el panel de creación rápida. Un botón que
                promete un formulario y abre un listado es peor que uno que
                dice a dónde va. */}
            <span className="text-[11px] text-white/60">{COTIZACION.nota}</span>
          </span>
        </div>
      </div>
    </section>
  );
}
