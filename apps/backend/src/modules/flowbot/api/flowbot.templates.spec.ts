import { compilar } from '../graph/flowbot.compiler';
import { CATALOGO } from '../graph/flowbot.graph';
import { sePuedePublicar, validarGrafo } from '../graph/flowbot.validator';
import { tieneEjecutor } from './flowbot.contracts';
import { PLANTILLAS, plantillaPorClave } from './flowbot.templates';

/**
 * Una plantilla rota es peor que ninguna: quien la elige confía en que
 * funciona y descubre lo contrario cuando ya está hablando con un cliente.
 *
 * Estas pruebas la validan con las MISMAS reglas que aplica la publicación.
 */
describe('plantillas oficiales', () => {
  it('hay ocho', () => {
    expect(PLANTILLAS).toHaveLength(8);
  });

  it('las claves no se repiten', () => {
    // La clave es cómo se pide una plantilla; dos iguales harían que una fuera
    // inalcanzable para siempre.
    const claves = PLANTILLAS.map((p) => p.clave);
    expect(new Set(claves).size).toBe(claves.length);
  });

  describe.each(PLANTILLAS.map((p) => [p.clave, p] as const))(
    '%s',
    (_clave, plantilla) => {
      it('tiene descripción, objetivo y categoría', () => {
        // Sin esto, el catálogo es una lista de nombres y nadie sabe cuál
        // elegir.
        expect(plantilla.nombre.length).toBeGreaterThan(3);
        expect(plantilla.descripcion.length).toBeGreaterThan(20);
        expect(plantilla.objetivo.length).toBeGreaterThan(20);
        expect(plantilla.categoria).toBeTruthy();
        expect(plantilla.requiere.length).toBeGreaterThan(0);
      });

      it('todos sus nodos existen en el catálogo', () => {
        for (const n of plantilla.graph.nodes) {
          expect(CATALOGO[n.type]).toBeDefined();
        }
      });

      it('todos sus nodos TIENEN ejecutor', () => {
        // Una plantilla con un nodo que no se puede ejecutar se publicaría y
        // fallaría a mitad de una conversación.
        for (const n of plantilla.graph.nodes) {
          expect({ nodo: n.id, listo: tieneEjecutor(n.type) }).toEqual({
            nodo: n.id,
            listo: true,
          });
        }
      });

      it('sus ÚNICOS errores son los campos que declara por completar', () => {
        // Es el contrato entero de una plantilla: o valida, o dice exactamente
        // qué falta. Cualquier error que no esté declarado es una plantilla
        // rota, y quien la elija lo descubriría hablando con un cliente.
        const problemas = validarGrafo(plantilla.graph);
        const errores = problemas.filter((p) => p.severidad === 'error');

        const declarados = new Set(
          plantilla.camposPorCompletar.map((c) => c.split('.')[0]),
        );
        const noDeclarados = errores.filter(
          (e) =>
            e.codigo !== 'config.obligatoria' ||
            !e.nodeId ||
            !declarados.has(e.nodeId),
        );

        expect({ clave: plantilla.clave, noDeclarados }).toEqual({
          clave: plantilla.clave,
          noDeclarados: [],
        });
        expect(errores.length).toBe(plantilla.camposPorCompletar.length);
      });

      it('sin campos pendientes, se puede publicar tal cual', () => {
        if (plantilla.camposPorCompletar.length > 0) return;

        const problemas = validarGrafo(plantilla.graph);
        expect(sePuedePublicar(problemas)).toBe(true);
        expect(compilar(plantilla.graph).ok).toBe(true);
      });

      it('empieza por un disparador', () => {
        const inicio = plantilla.graph.nodes.find(
          (n) => n.id === plantilla.graph.startNodeId,
        );
        expect(inicio).toBeDefined();
        expect(CATALOGO[inicio!.type].categoria).toBe('trigger');
      });

      it('NINGÚN par de nodos comparte posición', () => {
        // La versión anterior de esta prueba solo pedía que ALGUNO tuviera
        // posición, y por eso se coló que las ramas laterales quedaran las
        // tres apiladas en {0,0}: dibujadas una encima de otra parecen un
        // paso solo, y quien abre la plantilla cree que le falta media
        // plantilla. Lo encontró la QA visual, no esta prueba.
        const vistas = new Map<string, string>();
        for (const n of plantilla.graph.nodes) {
          const clave = `${n.position.x},${n.position.y}`;
          expect([n.id, vistas.get(clave)]).toEqual([n.id, undefined]);
          vistas.set(clave, n.id);
        }
      });

      it('no promete plazos ni descuentos', () => {
        // Lo que diga una plantilla se lo dice a un cliente de OTRA empresa, y
        // no sabemos qué puede cumplir.
        const textos = JSON.stringify(plantilla.graph).toLowerCase();
        for (const prohibido of [
          'descuento',
          'gratis',
          '24 horas',
          'inmediatamente',
          'garantizado',
        ]) {
          expect({
            clave: plantilla.clave,
            prohibido,
            aparece: textos.includes(prohibido),
          }).toEqual({ clave: plantilla.clave, prohibido, aparece: false });
        }
      });

      it('no menciona nada específico de Tehus', () => {
        const textos = JSON.stringify(plantilla.graph).toLowerCase();
        expect(textos).not.toContain('tehus');
        expect(textos).not.toContain('rattan');
      });

      it('cada campo declarado existe y va VACÍO', () => {
        // Poner una referencia de ejemplo haría que alguien publicara sin
        // cambiarla y le mandara a su cliente el catálogo de otro.
        for (const ref of plantilla.camposPorCompletar) {
          const [nodeId, campo] = ref.split('.');
          const n = plantilla.graph.nodes.find((x) => x.id === nodeId);
          expect({ ref, existe: Boolean(n) }).toEqual({ ref, existe: true });
          expect({ ref, valor: (n!.config ?? {})[campo] }).toEqual({
            ref,
            valor: '',
          });
        }
      });
    },
  );

  describe('búsqueda por clave', () => {
    it('encuentra una que existe', () => {
      expect(plantillaPorClave('bienvenida-calificacion')?.nombre).toBe(
        'Bienvenida y calificación',
      );
    });

    it('devuelve null para una que no', () => {
      expect(plantillaPorClave('inventada')).toBeNull();
    });
  });
});
