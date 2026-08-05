import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Guardas de una llamada HTTP saliente disparada por un flujo.
 *
 * SEPARADO DEL ADAPTADOR A PROPÓSITO: son funciones puras sobre cadenas e IPs,
 * así que se pueden probar exhaustivamente sin red ni base de datos. Un guardia
 * de SSRF que solo se ejercita a través de peticiones reales acaba con dos
 * casos probados y veinte sin probar.
 *
 * LO QUE EL VALIDADOR NO PUEDE HACER. Al publicar ya se comprueba el esquema y
 * la forma del host, pero eso no basta: `evil.com` puede resolver a `10.0.0.5`
 * en el momento de la llamada, o cambiar entre la comprobación y la petición.
 * Por eso aquí se resuelve el DNS y se miran las IPs REALES.
 */

/** Métodos que un flujo puede usar. Cerrado a propósito. */
export const METODOS_PERMITIDOS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Cabeceras que un nodo NO puede fijar.
 *
 * `authorization` y `cookie` porque las pone la credencial, no el flujo: si el
 * nodo pudiera escribirlas, cualquiera con permiso de edición mandaría el
 * token de la empresa a donde quisiera. `host` porque reescribirla es la forma
 * clásica de saltarse una lista de destinos permitidos.
 */
export const CABECERAS_PROHIBIDAS = [
  'authorization',
  'cookie',
  'host',
  'content-length',
  'connection',
  'proxy-authorization',
];

export type MotivoBloqueo =
  | 'url-invalida'
  | 'no-https'
  | 'credenciales-en-url'
  | 'puerto-no-permitido'
  | 'host-no-permitido'
  | 'ip-privada'
  | 'dns-no-resuelve'
  | 'metodo-no-permitido';

export interface ResultadoGuarda {
  ok: boolean;
  motivo?: MotivoBloqueo;
  /** Detalle ya redactado, seguro para el log. Nunca la URL completa. */
  detalle?: string;
}

/**
 * ¿Es una IP a la que un flujo nunca debe llegar?
 *
 * Cubre loopback, enlace local —incluido `169.254.169.254`, el metadata de
 * AWS, GCP y Azure, que es el objetivo número uno de un SSRF—, las tres
 * bandas privadas de IPv4, CGNAT, y sus equivalentes en IPv6 incluido el
 * mapeado `::ffff:10.0.0.1`, que se salta cualquier comprobación que solo mire
 * texto de IPv4.
 */
export function esIpInterna(ip: string): boolean {
  const limpia = ip
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');

  // IPv6 que envuelve una IPv4: `::ffff:192.168.1.1`. Sin desenvolverlo, una
  // comprobación por prefijos de IPv4 no lo vería.
  const mapeada = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(limpia);
  if (mapeada) return esIpInterna(mapeada[1]);

  if (isIP(limpia) === 6) {
    return (
      limpia === '::' ||
      limpia === '::1' ||
      limpia.startsWith('fe80:') || // enlace local
      limpia.startsWith('fc') || // única local
      limpia.startsWith('fd')
    );
  }

  const partes = limpia.split('.').map(Number);
  if (partes.length !== 4 || partes.some((n) => !Number.isInteger(n))) {
    return true; // lo que no se entiende se bloquea
  }
  const [a, b] = partes;

  return (
    a === 0 || // «esta red»
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // enlace local y metadata de nube
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || // documentación y protocolos
    a >= 224 // multicast y reservado
  );
}

/**
 * ¿Está el host en la lista de la empresa?
 *
 * Compara el host completo o un sufijo con punto: `api.ejemplo.com` entra si
 * la lista trae `api.ejemplo.com` o `ejemplo.com`. NO por `includes`, que
 * dejaría pasar `ejemplo.com.atacante.net`.
 *
 * UNA LISTA VACÍA NO ES «TODOS». Encender HTTP sin configurar destinos abriría
 * la salida a internet entero, que es justo lo que la lista existe para
 * evitar.
 */
export function hostPermitido(host: string, permitidos: string[]): boolean {
  if (permitidos.length === 0) return false;
  const h = host.trim().toLowerCase();
  return permitidos.some((p) => {
    const permitido = p.trim().toLowerCase();
    if (!permitido) return false;
    return h === permitido || h.endsWith(`.${permitido}`);
  });
}

/** Comprueba la forma de la URL, sin tocar la red. */
export function revisarUrl(
  url: string,
  permitidos: string[],
): ResultadoGuarda & { destino?: URL } {
  let destino: URL;
  try {
    destino = new URL(url);
  } catch {
    return { ok: false, motivo: 'url-invalida' };
  }

  if (destino.protocol !== 'https:') {
    return { ok: false, motivo: 'no-https' };
  }
  if (destino.username || destino.password) {
    // Viajan en logs, historiales y cabeceras de referencia.
    return { ok: false, motivo: 'credenciales-en-url' };
  }
  // Solo el puerto de HTTPS. Un puerto raro sobre https suele ser un servicio
  // interno expuesto por error, y no hay caso legítimo que lo necesite aquí.
  if (destino.port && destino.port !== '443') {
    return { ok: false, motivo: 'puerto-no-permitido', detalle: destino.port };
  }
  if (!hostPermitido(destino.hostname, permitidos)) {
    return {
      ok: false,
      motivo: 'host-no-permitido',
      detalle: destino.hostname,
    };
  }
  // Una IP literal en el host se comprueba ya: no hace falta esperar al DNS.
  if (isIP(destino.hostname) && esIpInterna(destino.hostname)) {
    return { ok: false, motivo: 'ip-privada' };
  }

  return { ok: true, destino };
}

/**
 * Resuelve el host y comprueba TODAS las direcciones.
 *
 * TODAS, no la primera: un dominio puede publicar una IP pública y otra
 * privada, y el sistema operativo elegiría cualquiera. Basta una interna para
 * bloquear.
 *
 * NO ELIMINA la condición de carrera del rebinding —entre esta resolución y la
 * conexión el DNS puede cambiar— pero sí la reduce a una ventana de
 * milisegundos frente a un ataque trivial. Cerrarla del todo exige conectar a
 * la IP ya validada con la cabecera `Host` original, que es un cambio de
 * agente HTTP y queda anotado como deuda.
 */
export async function revisarDns(host: string): Promise<ResultadoGuarda> {
  if (isIP(host)) {
    return esIpInterna(host)
      ? { ok: false, motivo: 'ip-privada' }
      : { ok: true };
  }

  let direcciones: Array<{ address: string }>;
  try {
    direcciones = await lookup(host, { all: true });
  } catch {
    return { ok: false, motivo: 'dns-no-resuelve' };
  }
  if (direcciones.length === 0) {
    return { ok: false, motivo: 'dns-no-resuelve' };
  }

  for (const d of direcciones) {
    if (esIpInterna(d.address)) {
      // El detalle NO lleva la IP: en un log compartido revelaría la topología
      // de la red interna a quien lo lea.
      return {
        ok: false,
        motivo: 'ip-privada',
        detalle: 'resuelve a red interna',
      };
    }
  }
  return { ok: true };
}

export function metodoPermitido(metodo: string): boolean {
  return METODOS_PERMITIDOS.includes(metodo.trim().toUpperCase());
}

/**
 * Limpia las cabeceras que declara el nodo.
 *
 * Devuelve solo las aceptadas y la lista de las descartadas, para poder
 * decírselo al autor del flujo en vez de ignorarlas en silencio.
 */
export function filtrarCabeceras(
  cabeceras: Record<string, string> | undefined,
): { seguras: Record<string, string>; descartadas: string[] } {
  const seguras: Record<string, string> = {};
  const descartadas: string[] = [];

  for (const [nombre, valor] of Object.entries(cabeceras ?? {})) {
    const clave = nombre.trim().toLowerCase();

    // Un nombre o un valor con salto de línea permite inyectar cabeceras
    // enteras, incluida la de autorización.
    if (!/^[a-z0-9-]{1,64}$/.test(clave) || /[\r\n]/.test(String(valor))) {
      descartadas.push(nombre);
      continue;
    }
    if (CABECERAS_PROHIBIDAS.includes(clave)) {
      descartadas.push(nombre);
      continue;
    }
    seguras[clave] = String(valor).slice(0, 2048);
  }
  return { seguras, descartadas };
}

/**
 * ¿Este fallo se arregla reintentando?
 *
 * Un 404 y un 429 no son lo mismo: reintentar el primero cinco veces gasta
 * cola para nada, y no reintentar el segundo pierde una llamada que habría
 * salido treinta segundos después.
 */
export function httpEsReintentable(estado: number | null): boolean {
  if (estado === null) return true; // fallo de red o tiempo agotado
  return estado === 408 || estado === 429 || estado >= 500;
}
