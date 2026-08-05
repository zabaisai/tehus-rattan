import { describe, expect, it } from 'vitest';
import type { GrafoFlow, NodoCatalogoDto, NodoFlow } from '@/lib/flowbots';
import {
  conexionValida,
  configuracionInicial,
  estadoDe,
  limpiarConexiones,
  nuevoId,
  puertosDe,
  resumenDe,
} from './grafo';

function def(parcial: Partial<NodoCatalogoDto>): NodoCatalogoDto {
  return {
    tipo: 'send.text',
    categoria: 'conversation',
    etiqueta: 'Mensaje',
    ayuda: 'Manda un mensaje',
    aceptaEntrada: true,
    puertos: [{ id: 'next', etiqueta: 'Continuar' }],
    config: [],
    esperaExterna: false,
    efectoExterno: false,
    requiereIA: false,
    rolMinimo: null,
    disponible: true,
    ...parcial,
  };
}

function nodo(parcial: Partial<NodoFlow> = {}): NodoFlow {
  return {
    id: 'n1',
    type: 'send.text',
    position: { x: 0, y: 0 },
    config: {},
    ...parcial,
  };
}

describe('puertos de un paso', () => {
  it('un menú de tres opciones tiene tres salidas, no una', () => {
    // Es el fallo más fácil de cometer: un menú NO sale por «Continuar», sale
    // por la opción que eligió el cliente. Dibujar `next` dejaría conectar una
    // rama que el motor no recorre nunca.
    const menu = def({
      tipo: 'send.buttons',
      puertosDinamicos: 'opciones',
      puertos: [{ id: 'timeout', etiqueta: 'Sin respuesta' }],
    });
    const n = nodo({
      type: 'send.buttons',
      config: { options: ['Ver precios', 'Hablar con alguien', 'Otra cosa'] },
    });

    const puertos = puertosDe(n, menu);

    expect(puertos.map((p) => p.id)).toEqual([
      'opcion:0',
      'opcion:1',
      'opcion:2',
      'timeout',
    ]);
  });

  it('cada salida se llama como la escribió la persona', () => {
    const menu = def({ puertosDinamicos: 'opciones', puertos: [] });
    const n = nodo({ config: { options: ['Ver precios'] } });

    // «opcion:0» no le dice nada a nadie mirando el lienzo.
    expect(puertosDe(n, menu)[0].etiqueta).toBe('Ver precios');
  });

  it('una opción todavía vacía se numera en vez de quedarse sin nombre', () => {
    const menu = def({ puertosDinamicos: 'opciones', puertos: [] });
    expect(puertosDe(nodo({ config: { options: ['  '] } }), menu)[0].etiqueta).toBe(
      'Opción 1',
    );
  });

  it('un paso de un tipo desconocido no se queda sin salidas', () => {
    // Pasa al abrir un flujo viejo con un tipo retirado: sin puerto, el nodo
    // queda mudo y no hay forma de ver a dónde iba.
    expect(puertosDe(nodo(), null)).toHaveLength(1);
  });
});

describe('conexiones', () => {
  const catalogo = new Map<string, NodoCatalogoDto>([
    ['send.text', def({})],
    [
      'trigger.inbound_message',
      def({ tipo: 'trigger.inbound_message', aceptaEntrada: false }),
    ],
  ]);

  const grafo: GrafoFlow = {
    schemaVersion: 1,
    startNodeId: 'inicio',
    nodes: [
      nodo({ id: 'inicio', type: 'trigger.inbound_message' }),
      nodo({ id: 'a' }),
      nodo({ id: 'b' }),
    ],
    edges: [{ id: 'e1', from: 'inicio', fromPort: 'next', to: 'a' }],
  };

  it('no deja conectar un paso consigo mismo', () => {
    const r = conexionValida(
      grafo,
      catalogo,
      { nodeId: 'a', port: 'next' },
      { nodeId: 'a' },
    );
    expect(r.ok).toBe(false);
  });

  it('no deja meter nada ANTES de un disparador', () => {
    const r = conexionValida(
      grafo,
      catalogo,
      { nodeId: 'a', port: 'next' },
      { nodeId: 'inicio' },
    );

    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('disparador');
  });

  it('no deja dos conexiones en la misma salida', () => {
    // Dos salidas del mismo puerto no significan «las dos»: significa que una
    // se ignora, y cuál es imposible de saber mirando el dibujo.
    const r = conexionValida(
      grafo,
      catalogo,
      { nodeId: 'inicio', port: 'next' },
      { nodeId: 'b' },
    );

    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('ya lleva');
  });

  it('deja la conexión normal', () => {
    expect(
      conexionValida(
        grafo,
        catalogo,
        { nodeId: 'a', port: 'next' },
        { nodeId: 'b' },
      ).ok,
    ).toBe(true);
  });
});

describe('limpieza al cambiar la configuración', () => {
  it('quitar una opción borra la conexión que colgaba de ella', () => {
    const catalogo = new Map<string, NodoCatalogoDto>([
      ['send.buttons', def({ puertosDinamicos: 'opciones', puertos: [] })],
      ['send.text', def({})],
    ]);

    const grafo: GrafoFlow = {
      schemaVersion: 1,
      startNodeId: 'menu',
      nodes: [
        nodo({ id: 'menu', type: 'send.buttons', config: { options: ['A'] } }),
        nodo({ id: 'x' }),
        nodo({ id: 'y' }),
      ],
      edges: [
        { id: 'e1', from: 'menu', fromPort: 'opcion:0', to: 'x' },
        // Esta cuelga de una opción que ya no existe.
        { id: 'e2', from: 'menu', fromPort: 'opcion:1', to: 'y' },
      ],
    };

    const limpio = limpiarConexiones(grafo, catalogo);

    expect(limpio.edges.map((e) => e.id)).toEqual(['e1']);
  });

  it('borra las conexiones a un paso que ya no está', () => {
    const catalogo = new Map<string, NodoCatalogoDto>([['send.text', def({})]]);
    const grafo: GrafoFlow = {
      schemaVersion: 1,
      startNodeId: 'a',
      nodes: [nodo({ id: 'a' })],
      edges: [{ id: 'e1', from: 'a', fromPort: 'next', to: 'fantasma' }],
    };

    expect(limpiarConexiones(grafo, catalogo).edges).toEqual([]);
  });

  it('si no sobra nada devuelve el MISMO objeto', () => {
    // Devolver una copia haría que el guardado automático detectara un cambio
    // en cada render y guardara sin parar.
    const catalogo = new Map<string, NodoCatalogoDto>([['send.text', def({})]]);
    const grafo: GrafoFlow = {
      schemaVersion: 1,
      startNodeId: 'a',
      nodes: [nodo({ id: 'a' }), nodo({ id: 'b' })],
      edges: [{ id: 'e1', from: 'a', fromPort: 'next', to: 'b' }],
    };

    expect(limpiarConexiones(grafo, catalogo)).toBe(grafo);
  });
});

describe('estado visual', () => {
  const conTexto = def({
    config: [{ nombre: 'text', tipo: 'texto', obligatorio: true }],
  });

  it('un paso al que le falta un campo obligatorio sale «incompleto»', () => {
    const estado = estadoDe(nodo(), conTexto, [
      { codigo: 'config.falta', severidad: 'error', mensaje: 'Falta el texto', nodeId: 'n1' },
    ]);

    expect(estado).toBe('incompleto');
  });

  it('un paso configurado pero mal puesto sale «inválido»', () => {
    // No es lo mismo: uno se arregla rellenando y el otro revisando.
    const estado = estadoDe(nodo({ config: { text: 'Hola' } }), conTexto, [
      { codigo: 'grafo.ciclo', severidad: 'error', mensaje: 'Bucle', nodeId: 'n1' },
    ]);

    expect(estado).toBe('invalido');
  });

  it('un tipo sin ejecutor sale deshabilitado aunque no tenga errores', () => {
    expect(estadoDe(nodo(), def({ disponible: false }), [])).toBe(
      'deshabilitado',
    );
  });

  it('los problemas de OTRO paso no lo ensucian', () => {
    const estado = estadoDe(nodo({ id: 'n1' }), conTexto, [
      { codigo: 'x', severidad: 'error', mensaje: 'algo', nodeId: 'otro' },
    ]);
    expect(estado).toBe('normal');
  });
});

describe('detalles del lienzo', () => {
  it('los identificadores nuevos no chocan con los que ya hay', () => {
    expect(nuevoId('send.text', new Set(['text-1', 'text-2']))).toBe('text-3');
  });

  it('una lista obligatoria arranca con una entrada', () => {
    // Un menú sin opciones no tiene ni una salida: el nodo nace sin puertos
    // que conectar y parece roto.
    const config = configuracionInicial(
      def({ config: [{ nombre: 'options', tipo: 'lista', obligatorio: true }] }),
    );
    expect(config.options).toEqual(['']);
  });

  it('el resumen enseña lo que se va a mandar, no el tipo del nodo', () => {
    expect(resumenDe(nodo({ config: { text: 'Hola, ¿en qué te ayudo?' } }), def({}))).toBe(
      'Hola, ¿en qué te ayudo?',
    );
  });

  it('un texto largo se recorta en vez de romper la caja', () => {
    const largo = 'x'.repeat(200);
    expect(resumenDe(nodo({ config: { text: largo } }), def({})).length).toBeLessThan(
      70,
    );
  });
});
