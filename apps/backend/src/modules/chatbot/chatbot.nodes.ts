/**
 * Definicion de un flujo de chatbot v1.
 *
 * Es una LISTA DE NODOS ENLAZADOS, no un grafo libre. Cada nodo dice cual es
 * el siguiente, y las opciones de un menu dicen a cual saltan. Con eso se
 * cubre lo que un chatbot comercial necesita —saludar, preguntar, ofrecer
 * opciones, pasar a una persona— sin prometer bucles ni condiciones que el
 * motor no ejecuta.
 */

export type TipoNodo = 'message' | 'question' | 'menu' | 'handoff' | 'end';

export interface OpcionMenu {
  /** Lo que ve el cliente. */
  label: string;
  /** Nodo al que salta. */
  next: string;
}

export interface NodoChatbot {
  id: string;
  type: TipoNodo;
  /** Texto que se envia. Vacio solo tiene sentido en `end`. */
  text?: string;
  /** Siguiente nodo, para `message` y `question`. */
  next?: string;
  /** Opciones de un `menu`. */
  options?: OpcionMenu[];
  /**
   * Para `question`: bajo que clave se guarda la respuesta del cliente. Es lo
   * que permite preguntar el nombre en el paso 1 y usarlo en el paso 4.
   */
  saveAs?: string;
}

export interface FlujoChatbot {
  /** Nodo por el que empieza. */
  start: string;
  nodes: NodoChatbot[];
}

/**
 * Tope de pasos por sesion.
 *
 * Corta bucles: un flujo mal construido que se apunte a si mismo escribiria al
 * cliente sin parar. Cuando se alcanza, la sesion pasa a manos humanas en vez
 * de morir en silencio — el cliente esta a mitad de algo y merece que alguien
 * lo recoja.
 */
export const MAXIMO_PASOS = 30;

export interface ProblemaFlujo {
  nodeId?: string;
  mensaje: string;
}

/**
 * Valida un flujo antes de publicarlo.
 *
 * Se valida al PUBLICAR y no al guardar el borrador: a media edicion un flujo
 * esta incompleto por definicion, y bloquear el guardado obligaria a
 * construirlo en el orden exacto que el validador espera.
 */
export function validarFlujo(flujo: FlujoChatbot): ProblemaFlujo[] {
  const problemas: ProblemaFlujo[] = [];
  const nodos = flujo?.nodes ?? [];

  if (!nodos.length) {
    return [{ mensaje: 'El flujo no tiene ningun nodo.' }];
  }

  const porId = new Map(nodos.map((n) => [n.id, n]));

  if (porId.size !== nodos.length) {
    problemas.push({ mensaje: 'Hay nodos con el mismo identificador.' });
  }

  if (!flujo.start || !porId.has(flujo.start)) {
    problemas.push({ mensaje: 'El nodo inicial no existe.' });
  }

  for (const nodo of nodos) {
    const exigeTexto = nodo.type !== 'end';
    if (exigeTexto && !nodo.text?.trim()) {
      problemas.push({
        nodeId: nodo.id,
        mensaje: 'No tiene texto que enviar.',
      });
    }

    if (nodo.type === 'menu') {
      const opciones = nodo.options ?? [];
      if (!opciones.length) {
        problemas.push({ nodeId: nodo.id, mensaje: 'Un menu sin opciones.' });
      }
      opciones.forEach((o, i) => {
        if (!o.label?.trim()) {
          problemas.push({
            nodeId: nodo.id,
            mensaje: `La opcion ${i + 1} no tiene texto.`,
          });
        }
        if (!porId.has(o.next)) {
          problemas.push({
            nodeId: nodo.id,
            mensaje: `La opcion "${o.label}" apunta a un nodo que no existe.`,
          });
        }
      });
    }

    // `message` y `question` deben continuar a algun sitio; si no, el cliente
    // se queda esperando una respuesta que nunca llega.
    if ((nodo.type === 'message' || nodo.type === 'question') && !nodo.next) {
      problemas.push({
        nodeId: nodo.id,
        mensaje: 'No dice cual es el siguiente paso.',
      });
    }
    if (nodo.next && !porId.has(nodo.next)) {
      problemas.push({
        nodeId: nodo.id,
        mensaje: 'Apunta a un nodo que no existe.',
      });
    }
  }

  // Nodos inalcanzables: no rompen nada, pero casi siempre son un enlace que
  // el autor creia haber hecho. Es un aviso, no un error, y por eso se
  // reporta igual que el resto para que se vea.
  const alcanzables = new Set<string>();
  const pendientes = [flujo.start].filter(Boolean);
  while (pendientes.length) {
    const id = pendientes.pop()!;
    if (alcanzables.has(id)) continue;
    alcanzables.add(id);
    const nodo = porId.get(id);
    if (!nodo) continue;
    if (nodo.next) pendientes.push(nodo.next);
    for (const o of nodo.options ?? []) pendientes.push(o.next);
  }
  for (const nodo of nodos) {
    if (!alcanzables.has(nodo.id)) {
      problemas.push({
        nodeId: nodo.id,
        mensaje: 'No se llega a este nodo desde el inicio.',
      });
    }
  }

  return problemas;
}

/**
 * Elige la opcion de un menu a partir de lo que escribio el cliente.
 *
 * Acepta el numero ("2") y tambien el texto de la opcion, porque la gente
 * responde de las dos formas y rechazar una de ellas convierte el menu en un
 * examen. La comparacion de texto ignora mayusculas y espacios sobrantes.
 */
export function elegirOpcion(
  nodo: NodoChatbot,
  respuesta: string,
): OpcionMenu | null {
  const opciones = nodo.options ?? [];
  const limpia = respuesta.trim().toLowerCase();
  if (!limpia) return null;

  const porNumero = Number(limpia);
  if (
    Number.isInteger(porNumero) &&
    porNumero >= 1 &&
    porNumero <= opciones.length
  ) {
    return opciones[porNumero - 1];
  }

  return (
    opciones.find((o) => o.label.trim().toLowerCase() === limpia) ??
    // Coincidencia parcial como ultimo recurso: "quiero el precio" deberia
    // encontrar la opcion "Precio". Solo si no hay ambiguedad.
    (() => {
      const candidatas = opciones.filter((o) =>
        limpia.includes(o.label.trim().toLowerCase()),
      );
      return candidatas.length === 1 ? candidatas[0] : null;
    })()
  );
}

/** Sustituye `{{clave}}` por lo que el cliente respondio antes. */
export function interpolar(
  texto: string,
  contexto: Record<string, unknown>,
): string {
  return texto.replace(
    /\{\{\s*([\w.-]+)\s*\}\}/g,
    (completo, clave: string) => {
      const valor = contexto?.[clave];
      // Sin valor se deja el texto tal cual en vez de escribir "undefined" al
      // cliente, que es lo que hace un replace ingenuo.
      //
      // Un objeto recibe el mismo trato: `String({})` es "[object Object]", y
      // mandarle eso a un cliente por WhatsApp es peor que dejar el hueco.
      // Las respuestas guardadas son texto, asi que el caso solo aparece si
      // algo escribio en el contexto lo que no debia.
      if (typeof valor === 'string') return valor;
      if (typeof valor === 'number' || typeof valor === 'boolean') {
        return String(valor);
      }
      return completo;
    },
  );
}
