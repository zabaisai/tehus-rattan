import { construirCatalogo, construirVariables } from './flowbot.contracts';
import { CATALOGO } from '../graph/flowbot.graph';
import { VARIABLES_SISTEMA } from '../graph/flowbot.variables';

/**
 * El catálogo es lo ÚNICO que el editor conoce del producto. Si algo se queda
 * fuera de aquí, no existe para quien construye un flujo: no se puede
 * arrastrar, no se puede insertar y no se puede configurar. Estas pruebas
 * fijan que nada se caiga por el camino al añadirlo al motor.
 */
describe('Contrato del catálogo', () => {
  const catalogo = construirCatalogo();

  it('publica todos los tipos del motor, sin filtrar ninguno', () => {
    // Filtrar aquí los no disponibles los haría invisibles; se mandan
    // marcados para que el editor pueda decir «todavía no» en vez de callar.
    expect(catalogo.nodos.map((n) => n.tipo).sort()).toEqual(
      Object.keys(CATALOGO).sort(),
    );
  });

  it('cada nodo declara al menos un puerto o termina el flujo', () => {
    // Sin puertos, el editor no puede dibujar de dónde sale la siguiente
    // conexión y el paso queda en un callejón sin salida invisible. Los tres
    // que no tienen son finales de verdad: `crm.handoff` también, porque a
    // partir de ahí atiende una persona y el bot ya no decide nada.
    const TERMINALES = ['control.end', 'control.cancel', 'crm.handoff'];

    for (const nodo of catalogo.nodos) {
      const ok = nodo.puertos.length > 0 || TERMINALES.includes(nodo.tipo);
      expect([nodo.tipo, ok]).toEqual([nodo.tipo, true]);
    }
  });

  it('los puertos vienen con etiqueta legible, no con el identificador crudo', () => {
    const condicion = catalogo.nodos.find(
      (n) => n.tipo === 'control.condition',
    );
    expect(condicion?.puertos.map((p) => p.etiqueta)).toEqual(
      expect.arrayContaining(['Sí', 'No']),
    );
  });

  it('un nodo sin ejecutor se marca no disponible y explica por qué', () => {
    for (const nodo of catalogo.nodos) {
      if (!nodo.disponible) {
        expect(nodo.motivoNoDisponible).toBeTruthy();
      }
    }
  });
});

describe('Contrato de variables', () => {
  const variables = construirVariables();
  const porRuta = new Map(variables.map((v) => [v.ruta, v]));

  it('incluye TODAS las variables del sistema', () => {
    for (const ruta of VARIABLES_SISTEMA) {
      expect([ruta, porRuta.has(ruta)]).toEqual([ruta, true]);
    }
  });

  it('incluye las que producen los nodos, aunque no sean del sistema', () => {
    const producidas = new Set(
      Object.values(CATALOGO).flatMap((d) => d.produce ?? []),
    );
    for (const ruta of producidas) {
      expect([ruta, porRuta.has(ruta)]).toEqual([ruta, true]);
    }
  });

  it('ninguna variable se queda sin descripción escrita', () => {
    // Sin esta prueba, añadir una variable al motor la sacaría en el selector
    // como `lead.value` a secas, y quien la lea tiene que adivinar qué trae.
    const sinDescribir = variables
      .filter((v) => v.etiqueta === v.ruta || v.grupo === 'Otras')
      .map((v) => v.ruta);

    expect(sinDescribir).toEqual([]);
  });

  it('no inventa variables que el motor no conoce', () => {
    // Al revés también importa: una variable descrita aquí pero inexistente
    // en el motor sería una que el validador rechaza justo al publicar.
    const conocidas = new Set([
      ...VARIABLES_SISTEMA,
      ...Object.values(CATALOGO).flatMap((d) => d.produce ?? []),
    ]);
    for (const v of variables) {
      expect([v.ruta, conocidas.has(v.ruta)]).toEqual([v.ruta, true]);
    }
  });

  it('las que dependen de un paso dicen qué paso las produce', () => {
    for (const v of variables) {
      if (!v.siempre) {
        expect([v.ruta, v.producidaPor?.length ?? 0]).not.toEqual([v.ruta, 0]);
      }
    }
  });

  it('los ejemplos son claramente falsos: nunca datos de nadie', () => {
    // Esta pantalla se comparte en capturas y la abre soporte.
    for (const v of variables) {
      expect(v.ejemplo).toBeTruthy();
      expect(v.ejemplo).not.toMatch(/@(gmail|hotmail|outlook)\.com$/i);
    }
  });
});
