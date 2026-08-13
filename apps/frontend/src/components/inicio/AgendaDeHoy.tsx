'use client';

import Link from 'next/link';
import { Task } from '@/types';
import { CLASES_PRIORIDAD, ETIQUETA_PRIORIDAD, PESO_PRIORIDAD } from '@/lib/tareas';

/**
 * La agenda del mockup 01: hora, prioridad y a qué pertenece cada tarea.
 *
 * NO CREA NI MODIFICA NADA. La casilla del mockup invita a marcar la tarea
 * como hecha; aquí no está, a propósito. Completar desde el Inicio es una
 * escritura, y este incremento es visual: el enlace lleva a la tarea, que es
 * donde ya existe esa acción con su confirmación y su registro.
 *
 * EL ORDEN ES POR VENCIMIENTO Y, A IGUALDAD DE HORA, POR PRIORIDAD. Ordenar
 * solo por hora deja «Urgente» debajo de «Baja» cuando ambas vencen a las
 * 9:00, que es justo cuando importa distinguirlas. Las tareas sin fecha van al
 * final: no tienen hora que respetar, pero siguen existiendo.
 */
const HORA = new Intl.DateTimeFormat('es-CO', {
  hour: 'numeric',
  minute: '2-digit',
});

const DIA_CORTO = new Intl.DateTimeFormat('es-CO', {
  day: 'numeric',
  month: 'short',
});

function esHoy(fecha: Date): boolean {
  const hoy = new Date();
  return (
    fecha.getFullYear() === hoy.getFullYear() &&
    fecha.getMonth() === hoy.getMonth() &&
    fecha.getDate() === hoy.getDate()
  );
}

export function ordenarAgenda(tareas: Task[]): Task[] {
  return [...tareas].sort((a, b) => {
    const fa = a.dueDate ?? '';
    const fb = b.dueDate ?? '';
    if (!fa && !fb) return PESO_PRIORIDAD[b.priority] - PESO_PRIORIDAD[a.priority];
    if (!fa) return 1;
    if (!fb) return -1;
    if (fa !== fb) return fa.localeCompare(fb);
    return PESO_PRIORIDAD[b.priority] - PESO_PRIORIDAD[a.priority];
  });
}

/**
 * Vencida = su hora ya pasó.
 *
 * Va en una función y no en una constante del cuerpo del componente porque
 * `react-hooks/purity` prohíbe —con razón— llamar a `Date.now()` durante el
 * render: el resultado cambiaría entre dos renders del mismo estado. Es el
 * mismo patrón que ya usan `timeAgo` y `antiguedadEnPalabras`.
 */
function estaVencida(vence: Date | null): boolean {
  return vence ? vence.getTime() < Date.now() : false;
}

export function AgendaDeHoy({ tareas }: { tareas: Task[] }) {
  return (
    <ul className="flex flex-col divide-y divide-line-default">
      {tareas.map((t) => {
        const vence = t.dueDate ? new Date(t.dueDate) : null;
        const vencida = estaVencida(vence);
        const vinculo = t.contact?.name ?? t.lead?.title ?? null;

        return (
          <li key={t.id} className="first:-mt-1 last:-mb-1">
            <Link
              // Enlace profundo: `?abrir=<id>` deja la tarea abierta en su
              // pantalla, igual que `?abrir=` en Productos. Antes llevaba al
              // listado entero y había que volver a buscarla.
              href={`/dashboard/tasks?abrir=${encodeURIComponent(t.id)}`}
              aria-label={`${t.title}. Prioridad ${ETIQUETA_PRIORIDAD[t.priority].toLowerCase()}${
                vence
                  ? `, ${vencida ? 'vencida' : 'vence'} ${esHoy(vence) ? `a las ${HORA.format(vence)}` : `el ${DIA_CORTO.format(vence)}`}`
                  : ', sin fecha'
              }. Abrir la tarea`}
              className="flex items-start gap-3 rounded-md px-2 py-2.5 outline-none transition-colors duration-rapida ease-standard hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-line-focus"
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="min-w-0 truncate text-sm font-medium text-content-primary">
                    {t.title}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${CLASES_PRIORIDAD[t.priority]}`}
                  >
                    {ETIQUETA_PRIORIDAD[t.priority]}
                  </span>
                </span>
                {vinculo && (
                  <span className="mt-0.5 block truncate text-xs text-content-secondary">
                    {vinculo}
                  </span>
                )}
              </span>

              <span
                aria-hidden="true"
                className={`shrink-0 text-right font-mono text-[11px] tabular-nums ${
                  vencida ? 'font-semibold text-status-error' : 'text-content-secondary'
                }`}
              >
                {vence ? (
                  <>
                    {esHoy(vence) ? HORA.format(vence) : DIA_CORTO.format(vence)}
                    {vencida && <span className="block text-[10px]">vencida</span>}
                  </>
                ) : (
                  'sin fecha'
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
