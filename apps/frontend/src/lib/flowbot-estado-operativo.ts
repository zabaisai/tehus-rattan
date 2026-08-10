import type { EstadoOperativo } from './flowbots';

/**
 * QUÉ ESTÁ PASANDO DE VERDAD CON LOS ENVÍOS, DECIDIDO EN UN SOLO SITIO.
 *
 * EL PROBLEMA QUE RESUELVE
 *
 * En staging la pantalla decía dos cosas a la vez: una alerta roja «Envíos
 * parados» y, justo debajo, una etiqueta verde «Enviando» sobre el número.
 * Ninguna de las dos era mentira por separado; el problema es que respondían a
 * preguntas distintas y nadie las había juntado:
 *
 *   - «Envíos parados» venía del KILL SWITCH.
 *   - «Enviando» venía del CIRCUIT BREAKER en estado `CLOSED`, que significa
 *     «este número no acumula fallos», NO «está enviando».
 *
 * Con el interruptor activo y el transporte en modo falso, un número sano tiene
 * el breaker cerrado; de ahí la etiqueta verde afirmando lo contrario de la
 * alerta roja de encima.
 *
 * CUATRO PREGUNTAS DISTINTAS
 *
 *   1. ¿El número está conectado?        -> `estadoIntegracion`
 *   2. ¿En qué modo está el transporte?  -> `modo`: falso | dry-run | real
 *   3. ¿Se permite enviar?               -> `killSwitch.activo`
 *   4. ¿Este número está sano?           -> `breaker.estado`
 *
 * Mezclarlas es lo que produjo el mensaje contradictorio. Este módulo las
 * mantiene separadas y calcula UNA conclusión con prioridad explícita.
 *
 * NO CAMBIA NINGUNA POLÍTICA DE SEGURIDAD. Solo interpreta lo que el servidor
 * ya decidió.
 */

/** Cómo de grave es lo que se comunica. El color se deriva de esto, nunca al revés. */
export type TonoOperativo = 'informativo' | 'aviso' | 'real' | 'error';

export interface VistaOperativa {
  tono: TonoOperativo;
  titulo: string;
  detalle: string;
  /**
   * Etiqueta corta del estado de SALIDA, para el número.
   *
   * Nunca dice «Enviando»: eso describiría algo ocurriendo en este instante, y
   * lo que aquí se conoce es un permiso, no una operación en curso.
   */
  etiquetaSalida: string;
  /** `true` solo si de verdad puede salir un mensaje a un cliente. */
  puedeSalirUnMensaje: boolean;
  /**
   * Motivo técnico del interruptor. Va en un detalle desplegable, no como
   * mensaje principal: suele traer un SHA de despliegue y una explicación
   * escrita para quien opera el servidor, no para quien usa el CRM.
   */
  detalleTecnico: string | null;
}

/**
 * Estado de la INTEGRACIÓN de un número, que es una pregunta independiente de
 * si se permite enviar.
 */
export function estadoDeIntegracion(estado: string | undefined): {
  conectado: boolean;
  etiqueta: string;
} {
  const conectado = estado === 'CONNECTED';
  return {
    conectado,
    etiqueta: conectado ? 'Número conectado' : 'Número desconectado',
  };
}

/**
 * Estado de SALUD de un número. `CLOSED` significa «sin fallos acumulados»,
 * no «enviando»: por eso la etiqueta habla de disponibilidad.
 */
export function estadoDeSalud(estado: string): {
  etiqueta: string;
  tono: 'success' | 'warning' | 'error';
} {
  if (estado === 'CLOSED') return { etiqueta: 'Sin fallos', tono: 'success' };
  if (estado === 'HALF_OPEN') {
    return { etiqueta: 'Probando tras fallos', tono: 'warning' };
  }
  return { etiqueta: 'En pausa por fallos', tono: 'error' };
}

/**
 * La conclusión, con la prioridad escrita a la vista.
 *
 * EL ORDEN IMPORTA y es este:
 *
 *   1. Integración desconectada  — sin número no hay envío posible.
 *   2. Transporte falso          — nada sale del proceso.
 *   3. Dry-run                   — se prepara todo y no se abre conexión.
 *   4. Real + kill switch        — ESTO SÍ es una alarma.
 *   5. Real sin kill switch      — envíos habilitados.
 *
 * EL KILL SWITCH SOLO PINTA EN ROJO CUANDO EL SISTEMA IRÍA A ENVIAR DE VERDAD.
 * Con el transporte en falso, el interruptor es un cinturón sobre unos tirantes:
 * anunciarlo como incidente rojo en un entorno de pruebas entrena a la gente a
 * ignorar las alertas rojas, que es exactamente lo que no se quiere el día que
 * una lo sea.
 */
export function vistaOperativa(estado: EstadoOperativo): VistaOperativa {
  const detalleTecnico = estado.killSwitch.activo
    ? construirDetalleTecnico(estado)
    : null;

  const hayNumeroConectado = (estado.numeros ?? []).some(
    (n) => n.estadoIntegracion === 'CONNECTED',
  );

  // 1. Sin número conectado no hay nada que discutir.
  if ((estado.numeros ?? []).length > 0 && !hayNumeroConectado) {
    return {
      tono: 'aviso',
      titulo: 'Número desconectado',
      detalle:
        'No hay ningún número de WhatsApp conectado. Los bots funcionan y no sale ningún mensaje.',
      etiquetaSalida: 'Envíos reales bloqueados',
      puedeSalirUnMensaje: false,
      detalleTecnico,
    };
  }

  // 4. Real + interruptor: la ÚNICA combinación que es una alarma.
  if (estado.modo === 'real' && estado.killSwitch.activo) {
    return {
      tono: 'error',
      titulo: 'Envíos detenidos por seguridad',
      detalle: motivoLegible(estado),
      etiquetaSalida: 'Envíos detenidos',
      puedeSalirUnMensaje: false,
      detalleTecnico,
    };
  }

  // 5. Real sin interruptor: habilitado. «Habilitados», no «Enviando»: lo que
  // se sabe es que se permite, no que esté ocurriendo algo ahora mismo.
  if (estado.modo === 'real') {
    return {
      tono: 'real',
      titulo: 'Envíos habilitados',
      detalle:
        'Lo que responda el bot le llega al cliente por WhatsApp. Revisa antes de activar un bot.',
      etiquetaSalida: 'Envíos habilitados',
      puedeSalirUnMensaje: true,
      detalleTecnico,
    };
  }

  // 3. Dry-run: se ejecuta todo el envío y no se abre conexión.
  if (estado.modo === 'dry-run') {
    return {
      tono: 'aviso',
      titulo: 'Modo de simulación',
      detalle:
        'Se prepara el envío completo y no sale nada hacia WhatsApp. Sirve para ver qué haría el bot con datos reales.',
      etiquetaSalida: 'Envíos reales bloqueados',
      puedeSalirUnMensaje: false,
      detalleTecnico,
    };
  }

  // 2. Transporte falso: el modo por defecto y el de staging.
  return {
    tono: 'informativo',
    titulo: 'Modo seguro de pruebas',
    detalle:
      'Los envíos reales de WhatsApp están desactivados en staging. Puedes diseñar y simular bots sin enviar mensajes reales.',
    etiquetaSalida: 'Envíos reales bloqueados',
    puedeSalirUnMensaje: false,
    detalleTecnico,
  };
}

/** Frase para quien administra, sin volcar el motivo técnico crudo. */
function motivoLegible(estado: EstadoOperativo): string {
  const cuando = estado.killSwitch.activadoEn
    ? new Date(estado.killSwitch.activadoEn).toLocaleString('es-CO', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : null;
  const quien = estado.killSwitch.activadoPor;

  const partes = ['Alguien activó el interruptor de emergencia'];
  if (quien) partes.push(`· ${quien}`);
  if (cuando) partes.push(`· ${cuando}`);
  return `${partes.join(' ')}. Ningún bot puede mandar mensajes hasta que se desactive.`;
}

/**
 * El texto crudo que quedó guardado al activar el interruptor.
 *
 * Suele mencionar un SHA de despliegue —«Activado en el despliegue a staging de
 * 347b957»— que hoy ya no es el release en marcha. Presentarlo como mensaje
 * principal hace creer que la versión desplegada es esa. Se conserva intacto en
 * la base y se enseña solo aquí, etiquetado como histórico.
 */
function construirDetalleTecnico(estado: EstadoOperativo): string | null {
  const { motivo, activadoEn, activadoPor } = estado.killSwitch;
  if (!motivo?.trim()) return null;

  const partes = [`Motivo registrado: ${motivo.trim()}`];
  if (activadoPor) partes.push(`Activado por: ${activadoPor}`);
  if (activadoEn) {
    partes.push(
      `Fecha: ${new Date(activadoEn).toLocaleString('es-CO', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })}`,
    );
  }
  return partes.join(' · ');
}
