import type { NodoCatalogoDto } from '@/lib/flowbots';

/**
 * Cómo se AGRUPAN los pasos en la paleta.
 *
 * ESTO NO ES UN SEGUNDO CATÁLOGO. No declara qué pasos existen, ni sus
 * puertos, ni su configuración: todo eso lo dice `GET /flowbots/catalog` y es
 * lo único que se dibuja. Aquí solo se decide en qué cajón cae cada uno,
 * porque las seis categorías del servidor son correctas pero demasiado
 * gruesas para buscar con la vista: «control» mete en el mismo montón esperar
 * dos horas, preguntar la hora y terminar el flujo.
 *
 * REGLA IMPORTANTE: un tipo que no encaje en ninguna regla NO se pierde —
 * cae en el grupo de su categoría del servidor. Si mañana el backend añade un
 * paso nuevo, aparece en la paleta sin tocar este archivo. Filtrar por una
 * lista escrita a mano es justo lo que haría que un paso nuevo fuera
 * invisible hasta que alguien se acordara de venir aquí.
 */
export interface GrupoPaleta {
  id: string;
  etiqueta: string;
  nodos: NodoCatalogoDto[];
}

const ORDEN: Array<{
  id: string;
  etiqueta: string;
  /** Devuelve true si el paso pertenece a este grupo. */
  cae: (n: NodoCatalogoDto) => boolean;
}> = [
  {
    id: 'inicio',
    etiqueta: 'Inicio y disparadores',
    cae: (n) => n.categoria === 'trigger',
  },
  {
    id: 'mensajeria',
    etiqueta: 'Mensajería',
    cae: (n) => n.tipo.startsWith('send.') && !esDeWhatsApp(n),
  },
  {
    id: 'whatsapp',
    etiqueta: 'WhatsApp',
    cae: esDeWhatsApp,
  },
  {
    id: 'preguntas',
    etiqueta: 'Preguntas y esperas',
    cae: (n) =>
      n.tipo.startsWith('ask.') ||
      n.tipo.startsWith('control.wait') ||
      n.tipo === 'control.business_hours',
  },
  {
    id: 'condiciones',
    etiqueta: 'Condiciones',
    cae: (n) =>
      n.tipo === 'control.condition' ||
      n.tipo === 'control.switch' ||
      n.tipo === 'control.random' ||
      n.tipo === 'control.jump',
  },
  {
    id: 'handoff',
    etiqueta: 'Pasar a una persona',
    cae: (n) => n.tipo === 'crm.handoff' || n.tipo === 'ai.detect_handoff',
  },
  {
    id: 'crm',
    etiqueta: 'CRM',
    cae: (n) => n.categoria === 'crm' || n.tipo.startsWith('conversation.'),
  },
  {
    id: 'integraciones',
    etiqueta: 'Integraciones',
    cae: (n) => n.categoria === 'integration',
  },
  { id: 'ia', etiqueta: 'IA', cae: (n) => n.categoria === 'ai' },
  {
    id: 'final',
    etiqueta: 'Finalización',
    cae: (n) => n.tipo === 'control.end' || n.tipo === 'control.cancel',
  },
];

/**
 * Las plantillas y los menús de WhatsApp van juntos: quien busca «mandar los
 * botones» no piensa en si técnicamente es un mensaje o una plantilla.
 */
function esDeWhatsApp(n: NodoCatalogoDto): boolean {
  return (
    n.tipo === 'send.template' ||
    n.tipo === 'send.buttons' ||
    n.tipo === 'send.list'
  );
}

/** Etiqueta de reserva para lo que no encaje: la que manda el servidor. */
const RESERVA: Record<string, string> = {
  trigger: 'Inicio y disparadores',
  conversation: 'Conversación',
  control: 'Control',
  crm: 'CRM',
  integration: 'Integraciones',
  ai: 'IA',
};

export function agrupar(
  nodos: NodoCatalogoDto[],
  categoriasServidor: Array<{ id: string; etiqueta: string }> = [],
): GrupoPaleta[] {
  const grupos = new Map<string, GrupoPaleta>();
  for (const g of ORDEN) {
    grupos.set(g.id, { id: g.id, etiqueta: g.etiqueta, nodos: [] });
  }

  for (const nodo of nodos) {
    const grupo = ORDEN.find((g) => g.cae(nodo));
    if (grupo) {
      grupos.get(grupo.id)!.nodos.push(nodo);
      continue;
    }

    // Sin regla: al cajón de su categoría, con la etiqueta que dé el
    // servidor si la manda.
    const id = `cat:${nodo.categoria}`;
    if (!grupos.has(id)) {
      const delServidor = categoriasServidor.find(
        (c) => c.id === nodo.categoria,
      );
      grupos.set(id, {
        id,
        etiqueta:
          delServidor?.etiqueta ?? RESERVA[nodo.categoria] ?? nodo.categoria,
        nodos: [],
      });
    }
    grupos.get(id)!.nodos.push(nodo);
  }

  return [...grupos.values()].filter((g) => g.nodos.length > 0);
}
