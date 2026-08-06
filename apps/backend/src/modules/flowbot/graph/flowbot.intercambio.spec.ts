import {
  analizarImportacion,
  ArchivoDeIntercambioInvalido,
  construirSobre,
  huellaDelGrafo,
  MAX_BYTES_IMPORTACION,
  sanearParaExportar,
} from './flowbot.intercambio';
import { GrafoFlow, VERSION_ESQUEMA_GRAFO } from './flowbot.graph';

/** Contador determinista: las pruebas no pueden depender de ids aleatorios. */
function contador() {
  let n = 0;
  return (semilla: string) => `${semilla}${++n}`;
}

function grafo(overrides: Partial<GrafoFlow> = {}): GrafoFlow {
  return {
    schemaVersion: VERSION_ESQUEMA_GRAFO,
    startNodeId: 'inicio',
    nodes: [
      {
        id: 'inicio',
        type: 'trigger.inbound_message',
        position: { x: 0, y: 0 },
        config: {},
      },
      {
        id: 'saludo',
        type: 'send.text',
        position: { x: 200, y: 0 },
        label: 'Saludar',
        config: { text: 'Hola, ¿en qué te ayudo?' },
      },
      {
        id: 'tarea',
        type: 'crm.task_create',
        position: { x: 400, y: 0 },
        config: { title: 'Llamar', assignedTo: 'usuario-de-la-empresa-origen' },
      },
    ],
    edges: [
      { id: 'e1', from: 'inicio', fromPort: 'next', to: 'saludo' },
      { id: 'e2', from: 'saludo', fromPort: 'next', to: 'tarea' },
    ],
    ...overrides,
  };
}

function sobreDe(g = grafo()) {
  return construirSobre({
    nombre: 'Bienvenida',
    descripcion: 'Saluda y deja una tarea',
    grafo: g,
    variables: ['contact.name'],
    ahora: new Date('2026-08-05T12:00:00.000Z'),
    version: 'test',
  });
}

describe('Intercambio de Pulsos — exportar', () => {
  /**
   * LO QUE NO PUEDE VIAJAR.
   *
   * Un `assignedTo` que apunta a un usuario de la empresa de origen, abierto
   * en otra empresa, asigna trabajo a quien no debe —o a nadie—. Se saca y se
   * anota como requisito: borrarlo en silencio haría que el bot importado
   * pareciera completo y fallara al publicarse.
   */
  it('saca las referencias a la empresa de origen y las anota como requisito', () => {
    const { grafo: limpio, requisitos } = sanearParaExportar(grafo());

    const tarea = limpio.nodes.find((n) => n.id === 'tarea')!;
    expect(tarea.config).not.toHaveProperty('assignedTo');
    expect(tarea.config).toHaveProperty('title', 'Llamar');

    expect(requisitos).toEqual([
      expect.objectContaining({
        nodeId: 'tarea',
        campo: 'assignedTo',
        tipo: 'user',
      }),
    ]);
  });

  it('el contenido que SÍ es del bot se conserva', () => {
    const { grafo: limpio } = sanearParaExportar(grafo());
    const saludo = limpio.nodes.find((n) => n.id === 'saludo')!;
    expect(saludo.config).toEqual({ text: 'Hola, ¿en qué te ayudo?' });
  });

  it('el sobre no contiene ningún secreto ni identificador de empresa', () => {
    const sobre = sobreDe();
    const texto = JSON.stringify(sobre);

    expect(texto).not.toContain('usuario-de-la-empresa-origen');
    expect(texto.toLowerCase()).not.toContain('token');
    expect(texto.toLowerCase()).not.toContain('secret');
  });

  it('la huella es estable ante el orden de nodos y conexiones', () => {
    const a = grafo();
    const b = grafo({
      nodes: [...grafo().nodes].reverse(),
      edges: [...grafo().edges].reverse(),
    });

    expect(huellaDelGrafo(a)).toBe(huellaDelGrafo(b));
  });
});

describe('Intercambio de Pulsos — importar', () => {
  it('acepta un archivo exportado por el propio producto', () => {
    const r = analizarImportacion(JSON.stringify(sobreDe()), contador());

    expect(r.sobre.metadatos.nombre).toBe('Bienvenida');
    expect(r.sobre.grafo.nodes).toHaveLength(3);
    expect(r.sobre.grafo.edges).toHaveLength(2);
    expect(r.nodosDesconocidos).toEqual([]);
    expect(r.checksumCoincide).toBe(true);
  });

  /**
   * IDA Y VUELTA.
   *
   * Exportar e importar tiene que devolver el mismo bot: mismos tipos de nodo,
   * mismas conexiones y misma forma. Si no, «exportar» es una función que
   * promete algo que no cumple.
   */
  it('ida y vuelta: la forma del bot sobrevive', () => {
    const original = grafo();
    const r = analizarImportacion(
      JSON.stringify(sobreDe(original)),
      contador(),
    );

    expect(r.sobre.grafo.nodes.map((n) => n.type)).toEqual(
      original.nodes.map((n) => n.type),
    );

    // Las conexiones se comparan por TIPO de nodo, porque los ids cambian a
    // propósito.
    const tipoDe = (g: GrafoFlow, id: string) =>
      g.nodes.find((n) => n.id === id)!.type;
    const aristasOriginales = original.edges.map(
      (e) => `${tipoDe(original, e.from)}->${tipoDe(original, e.to)}`,
    );
    const aristasImportadas = r.sobre.grafo.edges.map(
      (e) => `${tipoDe(r.sobre.grafo, e.from)}->${tipoDe(r.sobre.grafo, e.to)}`,
    );
    expect(aristasImportadas).toEqual(aristasOriginales);

    // Y el nodo de entrada sigue siendo el disparador.
    expect(tipoDe(r.sobre.grafo, r.sobre.grafo.startNodeId)).toBe(
      'trigger.inbound_message',
    );
  });

  it('los identificadores SIEMPRE se reasignan', () => {
    // Conservar los del origen invita a colisiones con bots que ya existen
    // aquí, y un id repetido hace que dos bots se pisen al editarlos.
    const r = analizarImportacion(JSON.stringify(sobreDe()), contador());

    const ids = r.sobre.grafo.nodes.map((n) => n.id);
    expect(ids).not.toContain('inicio');
    expect(ids).not.toContain('saludo');
    expect(new Set(ids).size).toBe(ids.length);
  });

  // ── lo que se rechaza ─────────────────────────────────────────

  it('rechaza un JSON que no es un Pulso exportado', () => {
    // No se promete compatibilidad con «cualquier JSON»: adivinar mal produce
    // un bot que parece bien y se comporta de otra forma.
    expect(() =>
      analizarImportacion(JSON.stringify({ nodes: [], edges: [] }), contador()),
    ).toThrow(/no es un Pulso exportado/i);
  });

  it('rechaza texto que ni siquiera es JSON', () => {
    expect(() => analizarImportacion('esto no es json', contador())).toThrow(
      ArchivoDeIntercambioInvalido,
    );
  });

  it('rechaza un archivo de una versión más nueva del formato', () => {
    const sobre = { ...sobreDe(), schemaVersion: 99 };
    expect(() =>
      analizarImportacion(JSON.stringify(sobre), contador()),
    ).toThrow(/versión más nueva/i);
  });

  it('rechaza un archivo demasiado grande', () => {
    const enorme = 'x'.repeat(MAX_BYTES_IMPORTACION + 1);
    expect(() => analizarImportacion(enorme, contador())).toThrow(
      /tamaño máximo/i,
    );
  });

  it('rechaza un grafo con más nodos de los permitidos', () => {
    const muchos = Array.from({ length: 400 }, (_, i) => ({
      id: `n${i}`,
      type: 'send.text',
      position: { x: 0, y: 0 },
      config: {},
    }));
    const sobre = { ...sobreDe(), grafo: { ...grafo(), nodes: muchos } };

    expect(() =>
      analizarImportacion(JSON.stringify(sobre), contador()),
    ).toThrow(/demasiados nodos/i);
  });

  it('rechaza configuración anidada demasiado hondo', () => {
    let hondo: Record<string, unknown> = { fin: true };
    for (let i = 0; i < 30; i++) hondo = { nivel: hondo };

    const sobre = {
      ...sobreDe(),
      grafo: {
        ...grafo(),
        nodes: [
          {
            id: 'a',
            type: 'send.text',
            position: { x: 0, y: 0 },
            config: hondo,
          },
        ],
      },
    };

    expect(() =>
      analizarImportacion(JSON.stringify(sobre), contador()),
    ).toThrow(/anidada demasiado hondo/i);
  });

  it('rechaza dos nodos con el mismo identificador', () => {
    const sobre = {
      ...sobreDe(),
      grafo: {
        ...grafo(),
        nodes: [
          { id: 'x', type: 'send.text', position: { x: 0, y: 0 }, config: {} },
          { id: 'x', type: 'send.text', position: { x: 0, y: 0 }, config: {} },
        ],
      },
    };

    expect(() =>
      analizarImportacion(JSON.stringify(sobre), contador()),
    ).toThrow(/mismo identificador/i);
  });

  // ── contaminación de prototipo ────────────────────────────────

  /**
   * ESTO ES LO QUE MÁS IMPORTA DE TODO EL ARCHIVO.
   *
   * Un `__proto__` dentro de un JSON puede cambiar el comportamiento de TODOS
   * los objetos del proceso, no solo del suyo. Se descarta al copiar.
   */
  it('NO deja pasar `__proto__` desde la configuración de un nodo', () => {
    const veneno = `{
      "formato": "taktoflow",
      "schemaVersion": 1,
      "metadatos": { "nombre": "Trampa" },
      "grafo": {
        "startNodeId": "a",
        "nodes": [{
          "id": "a", "type": "send.text", "position": {"x":0,"y":0},
          "config": { "__proto__": { "contaminado": true }, "text": "hola" }
        }],
        "edges": []
      }
    }`;

    const r = analizarImportacion(veneno, contador());

    expect(({} as Record<string, unknown>).contaminado).toBeUndefined();
    const config = r.sobre.grafo.nodes[0].config!;
    expect(Object.prototype.hasOwnProperty.call(config, '__proto__')).toBe(
      false,
    );
    expect(config.text).toBe('hola');
  });

  it('descarta `constructor` y `prototype` en la configuración', () => {
    const sobre = {
      ...sobreDe(),
      grafo: {
        ...grafo(),
        nodes: [
          {
            id: 'a',
            type: 'send.text',
            position: { x: 0, y: 0 },
            config: { constructor: 'x', prototype: 'y', text: 'bien' },
          },
        ],
        edges: [],
      },
    };

    const r = analizarImportacion(JSON.stringify(sobre), contador());
    const config = r.sobre.grafo.nodes[0].config!;

    expect(Object.prototype.hasOwnProperty.call(config, 'constructor')).toBe(
      false,
    );
    expect(Object.prototype.hasOwnProperty.call(config, 'prototype')).toBe(
      false,
    );
    expect(config.text).toBe('bien');
  });

  /**
   * `String(objeto)` produce "[object Object]".
   *
   * Esto lee un archivo de FUERA: un `type` que llegue como objeto acabaría
   * siendo el tipo de nodo literal «[object Object]». Es el mismo fallo que ya
   * mordió en la importación de productos, donde esa cadena acabó siendo el
   * nombre de un producto en el catálogo de un cliente.
   */
  it('un campo que llega como objeto NO se convierte en "[object Object]"', () => {
    const trampa = {
      formato: 'taktoflow',
      schemaVersion: 1,
      metadatos: { nombre: 'Trampa' },
      grafo: {
        startNodeId: 'a',
        nodes: [
          {
            id: 'a',
            type: { malicioso: true },
            position: { x: 0, y: 0 },
            config: {},
          },
        ],
        edges: [{ id: 'e', from: 'a', fromPort: { raro: 1 }, to: 'a' }],
      },
    };

    const r = analizarImportacion(JSON.stringify(trampa), contador());

    expect(r.sobre.grafo.nodes[0].type).not.toContain('[object Object]');
    expect(r.sobre.grafo.nodes[0].type).toBe('');
    // Y se reporta como tipo desconocido, que es lo que es.
    expect(r.nodosDesconocidos).toHaveLength(1);
    // El puerto cae al valor por defecto en vez de a una cadena inventada.
    expect(r.sobre.grafo.edges[0].fromPort).toBe('next');
  });

  // ── avisos que no impiden importar ────────────────────────────

  it('detecta nodos de un tipo desconocido y avisa, sin romper', () => {
    const sobre = {
      ...sobreDe(),
      grafo: {
        ...grafo(),
        nodes: [
          {
            id: 'a',
            type: 'inventado.que.no.existe',
            position: { x: 0, y: 0 },
            config: {},
          },
        ],
        edges: [],
      },
    };

    const r = analizarImportacion(JSON.stringify(sobre), contador());

    expect(r.nodosDesconocidos).toEqual([
      { id: 'a', type: 'inventado.que.no.existe' },
    ]);
    expect(r.avisos.join(' ')).toMatch(/no conoce/i);
  });

  it('descarta una conexión que apunta a un nodo inexistente y lo dice', () => {
    const sobre = {
      ...sobreDe(),
      grafo: {
        ...grafo(),
        edges: [
          { id: 'e1', from: 'inicio', fromPort: 'next', to: 'no-existe' },
        ],
      },
    };

    const r = analizarImportacion(JSON.stringify(sobre), contador());

    expect(r.sobre.grafo.edges).toHaveLength(0);
    expect(r.avisos.join(' ')).toMatch(/apuntaba a un nodo que no existe/i);
  });

  it('avisa si el archivo fue editado a mano después de exportarse', () => {
    const sobre = sobreDe();
    // Se cambia el grafo sin recalcular la huella.
    sobre.grafo.nodes[1].config = { text: 'otro texto' };

    const r = analizarImportacion(JSON.stringify(sobre), contador());

    expect(r.checksumCoincide).toBe(false);
    expect(r.avisos.join(' ')).toMatch(/modificado después de exportarse/i);
  });

  it('los requisitos se remapean a los ids nuevos', () => {
    const r = analizarImportacion(JSON.stringify(sobreDe()), contador());

    expect(r.sobre.requisitos).toHaveLength(1);
    // Apunta al id NUEVO, no al del archivo: si apuntara al viejo, la pantalla
    // no encontraría el nodo que hay que arreglar.
    expect(r.sobre.requisitos[0].nodeId).toBe(r.remapeo['tarea']);
    expect(r.sobre.requisitos[0].campo).toBe('assignedTo');
  });
});
