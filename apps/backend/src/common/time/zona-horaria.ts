/**
 * Tiempo en la zona horaria de la EMPRESA, nunca la del servidor.
 *
 * POR QUÉ IMPORTA. Un bot con horario «de 8 a 18» configurado por una empresa
 * en Bogotá tiene que respetarlo aunque el contenedor corra en UTC, que es lo
 * habitual. Con `Date#getHours()` el servidor decide, y a las 19:00 de Bogotá
 * —medianoche UTC— el bot creería que sigue en horario y contestaría a un
 * cliente que ya no espera respuesta. El error es invisible en local, donde el
 * desarrollador y el servidor comparten zona.
 *
 * SIN DEPENDENCIAS NUEVAS. `Intl.DateTimeFormat` con `timeZone` lo resuelve y
 * viene en Node con ICU completo. Una librería de fechas para esto sería
 * cargar dos megas para leer una hora.
 */

/** Las piezas de un instante ya vistas desde una zona concreta. */
export interface PartesLocales {
  anio: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  /** 0 = domingo, como `Date#getDay()`. */
  diaSemana: number;
}

/** Zona por defecto del producto. Coincide con `Company.timezone`. */
export const ZONA_POR_DEFECTO = 'America/Bogota';

const DIAS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * ¿Es una zona que el entorno entiende?
 *
 * Se comprueba en vez de confiar: `Company.timezone` es texto que alguien
 * escribió, y una zona inválida hace que `Intl` LANCE. Un bot no puede dejar
 * de responder porque un administrador escribió mal su ciudad.
 */
export function zonaValida(zona: string | null | undefined): boolean {
  if (!zona?.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zona });
    return true;
  } catch {
    return false;
  }
}

/** La zona pedida si vale; si no, la del producto. Nunca la del servidor. */
export function zonaSegura(zona: string | null | undefined): string {
  return zonaValida(zona) ? zona!.trim() : ZONA_POR_DEFECTO;
}

const cache = new Map<string, Intl.DateTimeFormat>();

function formateador(zona: string): Intl.DateTimeFormat {
  let f = cache.get(zona);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zona,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    });
    // Se cachea porque construir un formateador es caro y el motor lo llama
    // por nodo. Las zonas de un despliegue se cuentan con los dedos.
    cache.set(zona, f);
  }
  return f;
}

/** Descompone un instante en la zona indicada. */
export function partesEnZona(fecha: Date, zona: string): PartesLocales {
  const partes = formateador(zonaSegura(zona)).formatToParts(fecha);
  const leer = (tipo: string) =>
    Number(partes.find((p) => p.type === tipo)?.value ?? '0');

  return {
    anio: leer('year'),
    mes: leer('month'),
    dia: leer('day'),
    // `hour12: false` da 24 en vez de 0 para la medianoche en algunos motores.
    hora: leer('hour') % 24,
    minuto: leer('minute'),
    diaSemana:
      DIAS[partes.find((p) => p.type === 'weekday')?.value ?? 'Sun'] ?? 0,
  };
}

/** Horario comercial tal como lo configura una empresa. */
export interface EspecificacionHorario {
  /** Hora de apertura, 0–23. */
  fromHour?: unknown;
  /** Hora de cierre, 0–23. Puede ser MENOR que la de apertura. */
  toHour?: unknown;
  /** Días activos, 0 = domingo. Vacío o ausente = todos. */
  days?: unknown;
}

/**
 * ¿Estamos dentro del horario configurado?
 *
 * `null` cuando la configuración no se entiende. NO es `false`: un horario mal
 * escrito no puede silenciar un bot en silencio; quien llama decide, y en este
 * producto la decisión es dejarlo pasar y registrarlo.
 */
export function dentroDeHorario(
  fecha: Date,
  zona: string,
  spec: EspecificacionHorario,
): boolean | null {
  const desde = Number(spec.fromHour);
  const hasta = Number(spec.toHour);
  if (!Number.isFinite(desde) || !Number.isFinite(hasta)) return null;
  if (desde < 0 || desde > 23 || hasta < 0 || hasta > 23) return null;

  const local = partesEnZona(fecha, zona);

  if (Array.isArray(spec.days) && spec.days.length > 0) {
    const dias = spec.days.map(Number).filter((d) => Number.isInteger(d));
    if (dias.length > 0 && !dias.includes(local.diaSemana)) return false;
  }

  // Un rango que cruza la medianoche (22 a 6) no es un error de datos: hay
  // negocios nocturnos y turnos de guardia.
  return desde <= hasta
    ? local.hora >= desde && local.hora < hasta
    : local.hora >= desde || local.hora < hasta;
}

/**
 * Cuándo abre la próxima vez, a partir de un instante.
 *
 * Sirve para que un nodo de horario pueda ESPERAR hasta la apertura en vez de
 * salir por la rama de «cerrado». Devuelve `null` si el horario no se entiende
 * o si nunca abre —días vacíos imposibles— para que quien llama no se quede
 * esperando un instante que no llegará.
 *
 * Avanza hora a hora en vez de calcular el desplazamiento: con cambios de
 * horario de verano, sumar 24 h no siempre cae a la misma hora local, y el
 * bucle sí lo respeta porque vuelve a preguntar por la zona en cada paso. Como
 * mucho da ocho días de vueltas, que son 192 comprobaciones baratas.
 */
export function proximaApertura(
  desde: Date,
  zona: string,
  spec: EspecificacionHorario,
): Date | null {
  if (dentroDeHorario(desde, zona, spec) === null) return null;

  const HORA_MS = 3_600_000;
  // Se empieza en la siguiente hora en punto local para no devolver un
  // instante en mitad de la hora actual, que ya se descartó.
  let cursor = new Date(Math.ceil(desde.getTime() / HORA_MS) * HORA_MS);

  for (let i = 0; i < 24 * 8; i += 1) {
    if (dentroDeHorario(cursor, zona, spec) === true) return cursor;
    cursor = new Date(cursor.getTime() + HORA_MS);
  }
  return null;
}

/**
 * Interpreta una fecha escrita SIN zona como local de la empresa.
 *
 * «2026-08-10 14:00» significa las dos de la tarde donde está el negocio, no
 * en UTC. Sin esto, un recordatorio configurado para las 9 de la mañana
 * llegaría a las 4 de la madrugada.
 *
 * Si el texto SÍ trae zona —`Z` o `+05:00`— se respeta tal cual: quien la
 * escribió estaba siendo explícito.
 */
export function instanteLocal(texto: string, zona: string): Date | null {
  const limpio = texto.trim();
  if (!limpio) return null;

  const llevaZona = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(limpio);
  if (llevaZona) {
    const t = Date.parse(limpio);
    return Number.isFinite(t) ? new Date(t) : null;
  }

  const m =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(
      limpio,
    );
  if (!m) {
    // Formato desconocido: se deja a `Date.parse`, que lo tratará como UTC o
    // como local del servidor según el caso. Devolver `null` sería más
    // estricto, pero rompería flujos que ya funcionan con formatos raros.
    const t = Date.parse(limpio);
    return Number.isFinite(t) ? new Date(t) : null;
  }

  const [, anio, mes, dia, hora = '0', minuto = '0', segundo = '0'] = m;
  const comoUtc = Date.UTC(
    Number(anio),
    Number(mes) - 1,
    Number(dia),
    Number(hora),
    Number(minuto),
    Number(segundo),
  );

  // El desfase de la zona en ESE instante, no en el actual: así una fecha del
  // otro lado de un cambio de horario cae donde debe.
  const desfase = desfaseMs(new Date(comoUtc), zona);
  return new Date(comoUtc - desfase);
}

/** Cuántos milisegundos va la zona por delante de UTC en ese instante. */
export function desfaseMs(instante: Date, zona: string): number {
  const p = partesEnZona(instante, zona);
  const comoSiFueraUtc = Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto);
  // Se redondea el instante a minutos para comparar peras con peras: las
  // partes locales no llevan segundos.
  const real = Math.floor(instante.getTime() / 60_000) * 60_000;
  return comoSiFueraUtc - real;
}

/** Fecha legible en la zona de la empresa. Para paneles y explicaciones. */
export function formatearLocal(fecha: Date, zona: string): string {
  const p = partesEnZona(fecha, zona);
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${dos(p.dia)}/${dos(p.mes)}/${p.anio} ${dos(p.hora)}:${dos(p.minuto)}`;
}
