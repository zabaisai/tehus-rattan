import { Badge, type TonoBadge } from '@/components/ui/Badge';
import type { BotResumen } from '@/lib/flowbots';

/**
 * El estado de un bot tal y como lo entiende quien lo usa.
 *
 * NO ES EL CAMPO `status` A SECAS. Un bot puede estar `ACTIVE` y no atender a
 * nadie porque su única versión publicada falla en cada ejecución, y puede
 * estar `DRAFT` con cambios sin guardar. Enseñar la columna de la base tal
 * cual obliga a cada persona a reconstruir esa diferencia mirando otras tres
 * columnas, y la mayoría no lo hace.
 */
export type EstadoVisible =
  | 'borrador'
  | 'activo'
  | 'pausado'
  | 'inactivo'
  | 'con-errores'
  | 'archivado';

const ETIQUETAS: Record<EstadoVisible, { texto: string; tono: TonoBadge }> = {
  borrador: { texto: 'Borrador', tono: 'neutral' },
  activo: { texto: 'Activo', tono: 'success' },
  pausado: { texto: 'Pausado', tono: 'warning' },
  inactivo: { texto: 'Inactivo', tono: 'neutral' },
  'con-errores': { texto: 'Con errores', tono: 'error' },
  archivado: { texto: 'Archivado', tono: 'neutral' },
};

/** Cuántos errores recientes bastan para avisar. */
const ERRORES_PARA_AVISAR = 1;

export function estadoVisible(bot: BotResumen): EstadoVisible {
  if (bot.estado === 'ARCHIVED') return 'archivado';
  if (bot.estado === 'PAUSED') return 'pausado';

  if (bot.estado === 'ACTIVE') {
    // Un bot encendido que está fallando NO es un bot activo desde el punto de
    // vista de quien lo vigila: es el que hay que abrir primero.
    return bot.metricas.errores >= ERRORES_PARA_AVISAR ||
      bot.metricas.necesitanAtencion > 0
      ? 'con-errores'
      : 'activo';
  }

  // DRAFT con versión publicada = estuvo activo y se apagó. Llamarlo
  // «borrador» haría pensar que nunca llegó a funcionar.
  return bot.versionPublicada ? 'inactivo' : 'borrador';
}

export function EstadoBot({ bot }: { bot: BotResumen }) {
  const estado = ETIQUETAS[estadoVisible(bot)];
  return <Badge tone={estado.tono}>{estado.texto}</Badge>;
}
