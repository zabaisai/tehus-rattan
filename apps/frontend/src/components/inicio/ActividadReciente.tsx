'use client';

import { ActividadReciente as Fila } from '@/types';
import { autorDeActividad, etiquetaDeActividad, iconoDeActividad } from '@/lib/actividad';
import { timeAgo } from '@/lib/tiempo';

/**
 * Lo que ha pasado en la empresa, leído de la auditoría.
 *
 * POR QUÉ CAMBIÓ DE FUENTE. Este panel se apoyaba en `notifications`, que es
 * la bandeja PERSONAL de quien mira: una empresa con actividad real puede
 * tener el panel vacío simplemente porque nadie le ha generado un aviso a esa
 * persona. Es exactamente lo que ocurría en la vista previa —cuatro registros
 * de auditoría y cero notificaciones—, y la conclusión razonable de quien lo
 * ve es que el producto no registra nada.
 *
 * QUÉ NO SE ENSEÑA. El servidor no devuelve `metadata`, `reason`, `entityId`,
 * IP ni agente de usuario, así que aquí no hay nada que filtrar: llega lo que
 * se puede enseñar. El detalle completo vive en la pantalla de auditoría, que
 * tiene sus propios permisos.
 *
 * SIN ENLACE POR FILA. La auditoría no devuelve el identificador de la entidad
 * —deliberadamente—, así que no hay a dónde llevar. Un enlace que abre un
 * listado genérico promete más de lo que hace; la acción de cabecera sí lleva
 * a la auditoría completa.
 */
export function ActividadReciente({ filas }: { filas: Fila[] }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {filas.map((f) => {
        const Icono = iconoDeActividad(f.action);
        return (
          <li key={f.id} className="flex items-start gap-3 rounded-md px-2 py-2">
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-50 text-brand-primary"
            >
              <Icono size={14} />
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-content-primary">
                {etiquetaDeActividad(f.action)}
              </span>
              <span className="block truncate text-xs text-content-secondary">
                {autorDeActividad(f.actorName)}
              </span>
            </span>

            <time
              dateTime={f.createdAt}
              className="shrink-0 font-mono text-[11px] tabular-nums text-content-secondary"
            >
              {timeAgo(f.createdAt)}
            </time>
          </li>
        );
      })}
    </ul>
  );
}
