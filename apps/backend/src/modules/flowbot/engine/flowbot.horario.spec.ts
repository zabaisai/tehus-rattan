import { compilar } from '../graph/flowbot.compiler';
import { ConexionFlow, GrafoFlow, NodoFlow } from '../graph/flowbot.graph';
import { EfectosFalsos } from './flowbot.fake-effects';
import { avanzar } from './flowbot.interpreter';

/**
 * El horario y las esperas por fecha viven en la zona de la EMPRESA.
 *
 * Estas pruebas fijan instantes UTC concretos, no «ahora»: si usaran la hora
 * actual pasarían en Bogotá y fallarían en el contenedor, que corre en UTC y
 * es donde el fallo importa.
 */
const nodo = (
  id: string,
  type: NodoFlow['type'],
  config: Record<string, unknown> = {},
): NodoFlow => ({ id, type, position: { x: 0, y: 0 }, config });

const con = (from: string, fromPort: string, to: string): ConexionFlow => ({
  id: `${from}:${fromPort}->${to}`,
  from,
  fromPort,
  to,
});

const BOGOTA = 'America/Bogota';

function compilado(grafo: GrafoFlow) {
  const r = compilar(grafo);
  expect(r.ok).toBe(true);
  return r.compilado!;
}

/** Corre el flujo con el reloj fijado en un instante UTC concreto. */
async function correr(
  grafo: GrafoFlow,
  instanteUtc: string,
  zonaHoraria = BOGOTA,
) {
  const efectos = new EfectosFalsos({ dentroDeVentana: true });
  efectos.reloj.fijar(new Date(instanteUtc));

  const resultado = await avanzar(
    compilado(grafo),
    {
      companyId: 'emp-1',
      executionId: 'exec-1',
      correlationId: 'corr-1',
      conversationId: 'conv-1',
      contactId: 'cont-1',
      leadId: null,
      whatsappIntegrationId: null,
      currentNodeId: null,
      variables: {},
      steps: 0,
      zonaHoraria,
    },
    efectos,
    { maxPasos: 20 },
  );
  return { resultado, efectos };
}

describe('horario comercial y esperas con la zona de la empresa', () => {
  const HORARIO: GrafoFlow = {
    schemaVersion: 1,
    startNodeId: 'inicio',
    nodes: [
      nodo('inicio', 'trigger.inbound_message'),
      nodo('horario', 'control.business_hours', {
        fromHour: 8,
        toHour: 18,
        days: [1, 2, 3, 4, 5],
      }),
      nodo('abierto', 'send.text', { text: 'Te atendemos ahora' }),
      nodo('cerrado', 'send.text', { text: 'Estamos cerrados' }),
      nodo('fin', 'control.end'),
    ],
    edges: [
      con('inicio', 'next', 'horario'),
      con('horario', 'true', 'abierto'),
      con('horario', 'false', 'cerrado'),
      con('abierto', 'next', 'fin'),
      con('cerrado', 'next', 'fin'),
    ],
  };

  it('a las 14:00 de Bogotá sale por ABIERTO', async () => {
    // 19:00 UTC del martes = 14:00 en Bogotá.
    const { efectos } = await correr(HORARIO, '2026-08-04T19:00:00.000Z');
    expect(efectos.ultimo('enviarTexto')?.texto).toBe('Te atendemos ahora');
  });

  it('a las 19:00 de Bogotá sale por CERRADO aunque en UTC ya sea otro día', async () => {
    // 00:00 UTC del miércoles = 19:00 del martes en Bogotá. Con la hora del
    // servidor el bot creería que son las 00:00 y estaría fuera de todo
    // horario por casualidad, no por la regla.
    const { efectos } = await correr(HORARIO, '2026-08-05T00:00:00.000Z');
    expect(efectos.ultimo('enviarTexto')?.texto).toBe('Estamos cerrados');
  });

  it('el sábado sale por CERRADO', async () => {
    const { efectos } = await correr(HORARIO, '2026-08-08T16:00:00.000Z');
    expect(efectos.ultimo('enviarTexto')?.texto).toBe('Estamos cerrados');
  });

  it('con otra zona el MISMO instante cae del otro lado', async () => {
    // 00:00 UTC del miércoles: 19:00 del martes en Bogotá (cerrado), pero
    // 02:00 del miércoles en Madrid (también cerrado). Se usa Tokio, donde
    // son las 09:00 del miércoles: abierto.
    const { efectos } = await correr(
      HORARIO,
      '2026-08-05T00:00:00.000Z',
      'Asia/Tokyo',
    );
    expect(efectos.ultimo('enviarTexto')?.texto).toBe('Te atendemos ahora');
  });

  it('un horario que no es un número NI SIQUIERA SE PUBLICA', async () => {
    // La protección de verdad está antes: el validador lo rechaza, así que
    // una errata se ve en el editor y no en el silencio de un bot que dejó de
    // contestar. El ejecutor conserva su propia guarda como segunda barrera,
    // para una versión compilada antes de que el tipo existiera.
    const roto: GrafoFlow = {
      ...HORARIO,
      nodes: HORARIO.nodes.map((n) =>
        n.id === 'horario'
          ? { ...n, config: { fromHour: 'ocho', toHour: 18 } }
          : n,
      ),
    };
    const r = compilar(roto);
    expect(r.ok).toBe(false);
    expect(
      r.problemas.some(
        (p) => p.severidad === 'error' && p.nodeId === 'horario',
      ),
    ).toBe(true);
  });

  it('con esperar-a-que-abra, queda esperando en vez de disculparse', async () => {
    const esperando: GrafoFlow = {
      ...HORARIO,
      nodes: HORARIO.nodes.map((n) =>
        n.id === 'horario'
          ? { ...n, config: { ...n.config, waitUntilOpen: true } }
          : n,
      ),
    };
    // Viernes 23:00 en Bogotá = sábado 04:00 UTC.
    const { resultado } = await correr(esperando, '2026-08-08T04:00:00.000Z');

    expect(resultado.estado).toBe('WAITING_TIME');
    expect(resultado.espera?.kind).toBe('TIME');
    // Abre el lunes a las 8 de Bogotá = 13:00 UTC.
    expect(resultado.espera?.wakeAt?.toISOString()).toBe(
      '2026-08-10T13:00:00.000Z',
    );
  });

  it('esperar-a-que-abra con días imposibles sale por CERRADO, no duerme para siempre', async () => {
    const imposible: GrafoFlow = {
      ...HORARIO,
      nodes: HORARIO.nodes.map((n) =>
        n.id === 'horario'
          ? {
              ...n,
              config: {
                fromHour: 8,
                toHour: 18,
                days: [9],
                waitUntilOpen: true,
              },
            }
          : n,
      ),
    };
    const { efectos } = await correr(imposible, '2026-08-04T19:00:00.000Z');
    expect(efectos.ultimo('enviarTexto')?.texto).toBe('Estamos cerrados');
  });
});

describe('esperar hasta una fecha escrita por la empresa', () => {
  const grafo = (until: string): GrafoFlow => ({
    schemaVersion: 1,
    startNodeId: 'inicio',
    nodes: [
      nodo('inicio', 'trigger.inbound_message'),
      nodo('espera', 'control.wait_until', { until }),
      nodo('fin', 'control.end'),
    ],
    edges: [con('inicio', 'next', 'espera'), con('espera', 'next', 'fin')],
  });

  it('las 14:00 son las 14:00 DONDE ESTÁ el negocio', async () => {
    // Sin esto, un recordatorio para las 9 de la mañana llegaba a las 4 de la
    // madrugada, y en local nunca se veía.
    const { resultado } = await correr(
      grafo('2026-08-10 14:00'),
      '2026-08-04T12:00:00.000Z',
    );
    expect(resultado.espera?.wakeAt?.toISOString()).toBe(
      '2026-08-10T19:00:00.000Z',
    );
  });

  it('una fecha con zona explícita se respeta tal cual', async () => {
    const { resultado } = await correr(
      grafo('2026-08-10T14:00:00Z'),
      '2026-08-04T12:00:00.000Z',
    );
    expect(resultado.espera?.wakeAt?.toISOString()).toBe(
      '2026-08-10T14:00:00.000Z',
    );
  });

  it('una fecha ya pasada no es un error: el flujo sigue', async () => {
    const { resultado } = await correr(
      grafo('2020-01-01 10:00'),
      '2026-08-04T12:00:00.000Z',
    );
    expect(resultado.estado).toBe('COMPLETED');
  });

  it('una fecha ilegible falla como configuración, no como red', async () => {
    // Reintentarlo cinco veces no la va a arreglar.
    const { resultado } = await correr(
      grafo('el martes que viene'),
      '2026-08-04T12:00:00.000Z',
    );
    expect(resultado.estado).toBe('FAILED');
    expect(resultado.claseError).toBe('configuracion');
  });
});
