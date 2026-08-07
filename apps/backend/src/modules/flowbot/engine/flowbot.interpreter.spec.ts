import { compilar } from '../graph/flowbot.compiler';
import { ConexionFlow, GrafoFlow, NodoFlow } from '../graph/flowbot.graph';
import { EfectosFalsos } from './flowbot.fake-effects';
import {
  EstadoInicial,
  avanzar,
  esperaDeReintento,
} from './flowbot.interpreter';

// ── utilidades ────────────────────────────────────────────────

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

const grafo = (nodes: NodoFlow[], edges: ConexionFlow[] = []): GrafoFlow => ({
  schemaVersion: 1,
  startNodeId: 'inicio',
  nodes,
  edges,
});

function compilado(g: GrafoFlow) {
  const r = compilar(g);
  if (!r.ok) {
    throw new Error(
      `el grafo de la prueba no compila: ${r.problemas
        .filter((p) => p.severidad === 'error')
        .map((p) => p.codigo)
        .join(', ')}`,
    );
  }
  return r.compilado!;
}

/**
 * Compilado construido a mano, SIN pasar por el validador.
 *
 * El validador rechaza estos grafos, y hace bien. Pero los topes del motor
 * son una defensa de segundo nivel: existen para lo que el analisis estatico
 * no puede descartar —un grafo publicado con una version anterior del
 * validador, o un bucle que solo se cierra en ejecucion—. Probarlos exige
 * saltarse la primera barrera a proposito.
 */
function compiladoCrudo(
  nodos: Array<{
    id: string;
    type: NodoFlow['type'];
    config?: Record<string, unknown>;
    salidas?: Record<string, string>;
  }>,
  startNodeId = 'inicio',
) {
  return {
    schemaVersion: 1,
    startNodeId,
    triggerType: 'trigger.inbound_message' as NodoFlow['type'],
    triggerConfig: {},
    nodos: Object.fromEntries(
      nodos.map((n) => [
        n.id,
        {
          id: n.id,
          type: n.type,
          config: n.config ?? {},
          salidas: n.salidas ?? {},
          espera: false,
          efectoExterno: false,
          requiereIA: false,
        },
      ]),
    ),
  };
}

const estado = (extra: Partial<EstadoInicial> = {}): EstadoInicial => ({
  companyId: 'empresa-a',
  executionId: 'ejec-1',
  correlationId: 'corr-1',
  conversationId: 'conv-1',
  contactId: 'contacto-1',
  leadId: null,
  whatsappIntegrationId: 'wa-1',
  currentNodeId: null,
  variables: {},
  steps: 0,
  ...extra,
});

// ── pruebas ───────────────────────────────────────────────────

describe('intérprete de FlowBot', () => {
  describe('secuencia básica', () => {
    it('recorre disparador → mensaje → fin y registra cada paso', async () => {
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('saluda', 'send.text', { text: 'Hola' }),
          nodo('fin', 'control.end'),
        ],
        [con('inicio', 'next', 'saluda'), con('saluda', 'next', 'fin')],
      );
      const efectos = new EfectosFalsos();

      const r = await avanzar(compilado(g), estado(), efectos);

      expect(r.estado).toBe('COMPLETED');
      expect(r.pasos.map((p) => p.nodeId)).toEqual(['inicio', 'saluda', 'fin']);
      expect(efectos.vecesDe('enviarTexto')).toBe(1);
      expect(efectos.ultimo('enviarTexto')?.texto).toBe('Hola');
    });

    it('interpola variables justo antes de ejecutar el nodo', async () => {
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('saluda', 'send.text', { text: 'Hola {{contact.name}}' }),
          nodo('fin', 'control.end'),
        ],
        [con('inicio', 'next', 'saluda'), con('saluda', 'next', 'fin')],
      );
      const efectos = new EfectosFalsos();

      await avanzar(
        compilado(g),
        estado({ variables: { contact: { name: 'Ana' } } }),
        efectos,
      );

      expect(efectos.ultimo('enviarTexto')?.texto).toBe('Hola Ana');
    });

    it('una salida sin conectar termina la ejecución con su motivo', async () => {
      // El puerto `error` puede quedar suelto a proposito. Cuando el flujo
      // sale por el, la ejecucion termina registrando el motivo en vez de
      // fallar sin explicacion.
      const c = compiladoCrudo([
        {
          id: 'inicio',
          type: 'trigger.inbound_message',
          salidas: { next: 'lead' },
        },
        { id: 'lead', type: 'crm.lead_stage', config: { stageId: 's1' } },
      ]);
      const r = await avanzar(c, estado({ leadId: null }), new EfectosFalsos());

      // Sin leadId falla, y sin rama de error conectada queda en FAILED.
      expect(r.estado).toBe('FAILED');
      expect(r.claseError).toBe('no_encontrado');
    });

    it('un puerto de continuación sin destino termina con su motivo', async () => {
      const c = compiladoCrudo([
        {
          id: 'inicio',
          type: 'trigger.inbound_message',
          salidas: { next: 'saluda' },
        },
        { id: 'saluda', type: 'send.text', config: { text: 'Hola' } },
      ]);
      const r = await avanzar(c, estado(), new EfectosFalsos());

      expect(r.estado).toBe('COMPLETED');
      expect(r.motivo).toMatch(/sin continuación/);
    });
  });

  describe('condiciones', () => {
    const conCondicion = (operator: string, right: string) =>
      grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('si', 'control.condition', {
            left: '{{message.text}}',
            operator,
            right,
          }),
          nodo('si_si', 'send.text', { text: 'Sí' }),
          nodo('si_no', 'send.text', { text: 'No' }),
          nodo('fin', 'control.end'),
        ],
        [
          con('inicio', 'next', 'si'),
          con('si', 'true', 'si_si'),
          con('si', 'false', 'si_no'),
          con('si_si', 'next', 'fin'),
          con('si_no', 'next', 'fin'),
        ],
      );

    it('sale por verdadero cuando se cumple', async () => {
      const efectos = new EfectosFalsos();
      await avanzar(
        compilado(conCondicion('contiene', 'cotiz')),
        estado({ entrada: 'quiero cotizar' }),
        efectos,
      );
      expect(efectos.ultimo('enviarTexto')?.texto).toBe('Sí');
    });

    it('sale por falso cuando no', async () => {
      const efectos = new EfectosFalsos();
      await avanzar(
        compilado(conCondicion('contiene', 'cotiz')),
        estado({ entrada: 'hola' }),
        efectos,
      );
      expect(efectos.ultimo('enviarTexto')?.texto).toBe('No');
    });
  });

  describe('esperas', () => {
    const conPregunta = () =>
      grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('pide', 'ask.question', {
            text: '¿Tu nombre?',
            saveAs: 'nombre',
          }),
          nodo('saluda', 'send.text', { text: 'Gracias {{flow.nombre}}' }),
          nodo('fin', 'control.end'),
        ],
        [
          con('inicio', 'next', 'pide'),
          con('pide', 'next', 'saluda'),
          con('saluda', 'next', 'fin'),
        ],
      );

    it('una pregunta detiene la ejecución esperando entrada', async () => {
      const efectos = new EfectosFalsos();
      const r = await avanzar(compilado(conPregunta()), estado(), efectos);

      expect(r.estado).toBe('WAITING_INPUT');
      expect(r.espera?.resumeNodeId).toBe('pide');
      expect(r.currentNodeId).toBe('pide');
      // Preguntó una vez y se detuvo: no siguió al nodo de agradecimiento.
      expect(efectos.vecesDe('enviarTexto')).toBe(1);
    });

    it('al reanudar con la respuesta, la guarda y continúa', async () => {
      const c = compilado(conPregunta());
      const efectos = new EfectosFalsos();
      const primera = await avanzar(c, estado(), efectos);

      const segunda = await avanzar(
        c,
        estado({
          currentNodeId: primera.currentNodeId,
          variables: primera.variables,
          steps: primera.steps,
          entrada: 'Ana',
        }),
        efectos,
      );

      expect(segunda.estado).toBe('COMPLETED');
      expect(segunda.variables).toMatchObject({ flow: { nombre: 'Ana' } });
      expect(efectos.ultimo('enviarTexto')?.texto).toBe('Gracias Ana');
    });

    it('la entrada la consume UN SOLO nodo', async () => {
      // Sin esto, la siguiente pregunta se autorresponderia con el mismo texto
      // y el cliente veria dos preguntas contestadas por el mismo mensaje.
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('p1', 'ask.question', { text: 'Nombre?', saveAs: 'a' }),
          nodo('p2', 'ask.question', { text: 'Correo?', saveAs: 'b' }),
          nodo('fin', 'control.end'),
        ],
        [
          con('inicio', 'next', 'p1'),
          con('p1', 'next', 'p2'),
          con('p2', 'next', 'fin'),
        ],
      );
      const c = compilado(g);
      const efectos = new EfectosFalsos();
      const primera = await avanzar(c, estado(), efectos);

      const segunda = await avanzar(
        c,
        estado({
          currentNodeId: primera.currentNodeId,
          variables: primera.variables,
          steps: primera.steps,
          entrada: 'Ana',
        }),
        efectos,
      );

      expect(segunda.estado).toBe('WAITING_INPUT');
      expect(segunda.variables).toMatchObject({ flow: { a: 'Ana' } });
      expect(segunda.variables).not.toMatchObject({ flow: { b: 'Ana' } });
    });

    it('una espera por tiempo fija cuándo despertar', async () => {
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('espera', 'control.wait_duration', { seconds: 3600 }),
          nodo('fin', 'control.end'),
        ],
        [con('inicio', 'next', 'espera'), con('espera', 'next', 'fin')],
      );
      const efectos = new EfectosFalsos();
      const r = await avanzar(compilado(g), estado(), efectos);

      expect(r.estado).toBe('WAITING_TIME');
      expect(r.espera?.kind).toBe('TIME');
      expect(r.espera!.wakeAt!.getTime()).toBe(
        efectos.reloj.ahora().getTime() + 3600_000,
      );
    });

    it('al vencer sale por el puerto de timeout SIN repetir la pregunta', async () => {
      // Volver a ejecutar el nodo reenviaria la pregunta al cliente.
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('pide', 'ask.question', {
            text: '¿Sigues ahí?',
            saveAs: 'x',
            timeoutSeconds: 60,
          }),
          nodo('sigue', 'send.text', { text: 'Gracias' }),
          nodo('venció', 'send.text', { text: 'Te escribo luego' }),
          nodo('fin', 'control.end'),
        ],
        [
          con('inicio', 'next', 'pide'),
          con('pide', 'next', 'sigue'),
          con('pide', 'timeout', 'venció'),
          con('sigue', 'next', 'fin'),
          con('venció', 'next', 'fin'),
        ],
      );
      const c = compilado(g);
      const efectos = new EfectosFalsos();
      const primera = await avanzar(c, estado(), efectos);
      const enviosTrasPreguntar = efectos.vecesDe('enviarTexto');

      const segunda = await avanzar(
        c,
        estado({
          currentNodeId: primera.currentNodeId,
          variables: primera.variables,
          steps: primera.steps,
          porTimeout: { desdeNodo: 'pide', puerto: 'timeout' },
        }),
        efectos,
      );

      expect(segunda.estado).toBe('COMPLETED');
      expect(efectos.ultimo('enviarTexto')?.texto).toBe('Te escribo luego');
      expect(efectos.vecesDe('enviarTexto')).toBe(enviosTrasPreguntar + 1);
    });

    it('sin rama de timeout, vencer termina la ejecución en vez de fallar', async () => {
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('pide', 'ask.question', {
            text: '?',
            saveAs: 'x',
            timeoutSeconds: 60,
          }),
          nodo('fin', 'control.end'),
        ],
        [con('inicio', 'next', 'pide'), con('pide', 'next', 'fin')],
      );
      const r = await avanzar(
        compilado(g),
        estado({
          currentNodeId: 'pide',
          steps: 2,
          porTimeout: { desdeNodo: 'pide', puerto: 'timeout' },
        }),
        new EfectosFalsos(),
      );
      expect(r.estado).toBe('COMPLETED');
    });
  });

  describe('validación de respuestas', () => {
    const pidiendo = (
      tipo: NodoFlow['type'],
      config: Record<string, unknown>,
    ) =>
      grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('pide', tipo, config),
          nodo('fin', 'control.end'),
        ],
        [con('inicio', 'next', 'pide'), con('pide', 'next', 'fin')],
      );

    const responder = async (
      g: GrafoFlow,
      respuesta: string,
      efectos = new EfectosFalsos(),
    ) => {
      const c = compilado(g);
      const primera = await avanzar(c, estado(), efectos);
      return avanzar(
        c,
        estado({
          currentNodeId: primera.currentNodeId,
          variables: primera.variables,
          steps: primera.steps,
          entrada: respuesta,
        }),
        efectos,
      );
    };

    it('acepta un correo válido y lo normaliza a minúsculas', async () => {
      const r = await responder(
        pidiendo('ask.email', { text: 'Correo?', saveAs: 'correo' }),
        'ANA@Ejemplo.COM',
      );
      expect(r.estado).toBe('COMPLETED');
      expect(r.variables).toMatchObject({
        flow: { correo: 'ana@ejemplo.com' },
      });
    });

    it('vuelve a esperar si el correo no vale, sin avanzar', async () => {
      const r = await responder(
        pidiendo('ask.email', { text: 'Correo?', saveAs: 'correo' }),
        'esto no es un correo',
      );
      expect(r.estado).toBe('WAITING_INPUT');
      expect(r.variables).not.toMatchObject({
        flow: { correo: expect.anything() },
      });
    });

    it('normaliza el teléfono a E.164', async () => {
      const r = await responder(
        pidiendo('ask.phone', { text: 'Teléfono?', saveAs: 'tel' }),
        '300 111 2233',
      );
      expect(r.variables).toMatchObject({ flow: { tel: '+3001112233' } });
    });

    it('respeta el rango de un número', async () => {
      const g = pidiendo('ask.number', {
        text: 'Cuántos?',
        saveAs: 'n',
        min: 1,
        max: 10,
      });
      await expect(responder(g, '5')).resolves.toMatchObject({
        estado: 'COMPLETED',
      });
      await expect(responder(g, '50')).resolves.toMatchObject({
        estado: 'WAITING_INPUT',
      });
    });

    it('entiende una fecha en formato colombiano', async () => {
      const r = await responder(
        pidiendo('ask.date', { text: 'Cuándo?', saveAs: 'f' }),
        '15/03/2026',
      );
      expect(r.estado).toBe('COMPLETED');
      expect(String((r.variables.flow as Record<string, string>).f)).toContain(
        '2026-03-15',
      );
    });
  });

  describe('ventana de WhatsApp', () => {
    it('NO manda texto libre fuera de la ventana: sale por error', async () => {
      // Intentarlo produce un rechazo del proveedor y el cliente se queda sin
      // respuesta sin que nadie sepa por que.
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('t', 'send.text', { text: 'Hola' }),
          nodo('plantilla', 'send.template', { templateName: 'reenganche' }),
          nodo('fin', 'control.end'),
        ],
        [
          con('inicio', 'next', 't'),
          con('t', 'next', 'fin'),
          con('t', 'error', 'plantilla'),
          con('plantilla', 'next', 'fin'),
        ],
      );
      const efectos = new EfectosFalsos({ dentroDeVentana: false });

      const r = await avanzar(compilado(g), estado(), efectos);

      expect(efectos.vecesDe('enviarTexto')).toBe(0);
      expect(efectos.vecesDe('enviarPlantilla')).toBe(1);
      expect(r.estado).toBe('COMPLETED');
    });

    it('una plantilla SÍ se envía fuera de la ventana', async () => {
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('p', 'send.template', { templateName: 'aviso' }),
          nodo('fin', 'control.end'),
        ],
        [con('inicio', 'next', 'p'), con('p', 'next', 'fin')],
      );
      const efectos = new EfectosFalsos({ dentroDeVentana: false });

      const r = await avanzar(compilado(g), estado(), efectos);

      expect(r.estado).toBe('COMPLETED');
      expect(efectos.vecesDe('enviarPlantilla')).toBe(1);
    });
  });

  describe('CRM', () => {
    it('crea oportunidad y tarea, y las encadena por variables', async () => {
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('lead', 'crm.lead_create', {
            title: 'Interés',
            pipelineId: 'p1',
            stageId: 's1',
          }),
          nodo('tarea', 'crm.task_create', { title: 'Llamar', dueInHours: 24 }),
          nodo('fin', 'control.end'),
        ],
        [
          con('inicio', 'next', 'lead'),
          con('lead', 'next', 'tarea'),
          con('tarea', 'next', 'fin'),
        ],
      );
      const efectos = new EfectosFalsos();

      const r = await avanzar(compilado(g), estado(), efectos);

      expect(r.estado).toBe('COMPLETED');
      expect(efectos.vecesDe('crearOportunidad')).toBe(1);
      expect(efectos.vecesDe('crearTarea')).toBe(1);
      expect(r.variables.lead).toMatchObject({ id: expect.any(String) });

      // «Crear tarea» NO crea una tarea cuando la empresa exige aprobación, y
      // exigirla es lo predeterminado: deja una PROPUESTA. El bot no puede
      // meter trabajo en la lista de una persona sin que esa persona lo
      // acepte, así que aquí `task.id` es null a propósito y lo que existe es
      // `suggestion.id`.
      expect(r.variables.task).toMatchObject({ id: null });
      expect(r.variables.suggestion).toMatchObject({
        id: expect.any(String),
        propuesta: true,
      });
    });

    it('el round-robin sin asesores disponibles NO corta la conversación', async () => {
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('rr', 'crm.lead_assign_round_robin', {}),
          nodo('fin', 'control.end'),
        ],
        [con('inicio', 'next', 'rr'), con('rr', 'next', 'fin')],
      );
      const efectos = new EfectosFalsos({ siguienteEnTurno: null });

      const r = await avanzar(compilado(g), estado(), efectos);

      expect(r.estado).toBe('COMPLETED');
      expect(r.pasos.find((p) => p.nodeId === 'rr')?.meta).toMatchObject({
        sinAsesores: true,
      });
    });

    it('la nota interna escapa el HTML que venga del cliente', async () => {
      // La nota se pinta en el panel del asesor: sin escapar, un mensaje del
      // cliente ataca a quien lo lee.
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('n', 'conversation.note', { text: 'Dijo: {{message.text}}' }),
          nodo('fin', 'control.end'),
        ],
        [con('inicio', 'next', 'n'), con('n', 'next', 'fin')],
      );
      const efectos = new EfectosFalsos();

      await avanzar(
        compilado(g),
        estado({ entrada: '<img src=x onerror=alert(1)>' }),
        efectos,
      );

      expect(String(efectos.ultimo('notaInterna')?.texto)).not.toContain(
        '<img',
      );
      expect(String(efectos.ultimo('notaInterna')?.texto)).toContain('&lt;img');
    });
  });

  describe('transferencia a humano', () => {
    it('detiene la ejecución y marca HANDED_OFF', async () => {
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('h', 'crm.handoff', { reason: 'Pidió hablar con alguien' }),
        ],
        [con('inicio', 'next', 'h')],
      );
      const efectos = new EfectosFalsos();

      const r = await avanzar(compilado(g), estado(), efectos);

      expect(r.estado).toBe('HANDED_OFF');
      expect(r.motivo).toBe('Pidió hablar con alguien');
      expect(efectos.vecesDe('transferir')).toBe(1);
    });
  });

  describe('límites', () => {
    it('corta al superar el tope de pasos y lo marca como fallo', async () => {
      // Terminar en silencio esconderia el problema.
      const c = compiladoCrudo([
        {
          id: 'inicio',
          type: 'trigger.inbound_message',
          salidas: { next: 'a' },
        },
        { id: 'a', type: 'control.jump', salidas: { next: 'b' } },
        { id: 'b', type: 'control.jump', salidas: { next: 'a' } },
      ]);
      const r = await avanzar(c, estado(), new EfectosFalsos(), {
        maxPasos: 10,
        maxPasosPorTanda: 100,
      });

      expect(r.estado).toBe('FAILED');
      expect(r.errorCode).toBe('limite-de-pasos');
      expect(r.reintentable).toBe(false);
      expect(r.steps).toBe(10);
    });

    it('cede el turno al llegar al tope de la tanda, sin perder estado', async () => {
      const c = compiladoCrudo([
        {
          id: 'inicio',
          type: 'trigger.inbound_message',
          salidas: { next: 'a' },
        },
        { id: 'a', type: 'control.jump', salidas: { next: 'b' } },
        { id: 'b', type: 'control.jump', salidas: { next: 'a' } },
      ]);
      const r = await avanzar(c, estado(), new EfectosFalsos(), {
        maxPasos: 100,
        maxPasosPorTanda: 5,
      });

      expect(r.estado).toBe('RUNNING');
      expect(r.steps).toBe(5);
      expect(r.currentNodeId).toBeTruthy();
    });
  });

  describe('errores', () => {
    it('un fallo definitivo con rama de error sigue por ella', async () => {
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('lead', 'crm.lead_stage', { stageId: 's1' }),
          nodo('rescate', 'send.text', { text: 'Seguimos' }),
          nodo('fin', 'control.end'),
        ],
        [
          con('inicio', 'next', 'lead'),
          con('lead', 'next', 'fin'),
          con('lead', 'error', 'rescate'),
          con('rescate', 'next', 'fin'),
        ],
      );
      const efectos = new EfectosFalsos();

      // Sin `leadId`, mover de etapa falla con `sin-oportunidad`.
      const r = await avanzar(compilado(g), estado({ leadId: null }), efectos);

      expect(r.estado).toBe('COMPLETED');
      expect(efectos.ultimo('enviarTexto')?.texto).toBe('Seguimos');
    });

    it('un fallo definitivo SIN rama de error termina en FAILED y no se reintenta', async () => {
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('lead', 'crm.lead_stage', { stageId: 's1' }),
          nodo('fin', 'control.end'),
        ],
        [con('inicio', 'next', 'lead'), con('lead', 'next', 'fin')],
      );
      const r = await avanzar(
        compilado(g),
        estado({ leadId: null }),
        new EfectosFalsos(),
      );

      expect(r.estado).toBe('FAILED');
      expect(r.claseError).toBe('no_encontrado');
      expect(r.reintentable).toBe(false);
    });

    it('un ejecutor que revienta se clasifica como interno y SÍ se reintenta', async () => {
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('t', 'send.text', { text: 'Hola' }),
          nodo('fin', 'control.end'),
        ],
        [con('inicio', 'next', 't'), con('t', 'next', 'fin')],
      );
      const efectos = new EfectosFalsos();
      efectos.mensajeria.enviarTexto = () => {
        throw new Error('la red se cayó');
      };

      const r = await avanzar(compilado(g), estado(), efectos);

      expect(r.estado).toBe('FAILED');
      expect(r.claseError).toBe('interno');
      expect(r.reintentable).toBe(true);
      // El mensaje crudo puede llevar datos del cliente: solo se guarda el
      // nombre del error.
      expect(r.errorCode).toBe('Error');
      expect(JSON.stringify(r)).not.toContain('la red se cayó');
    });
  });

  describe('reparto por porcentaje', () => {
    it('es DETERMINISTA por ejecución: un reintento cae por la misma rama', async () => {
      // Con azar real, un reintento tras un fallo enviaria al cliente por el
      // otro camino y dejaria la conversacion incoherente.
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('r', 'control.random', { percent: 50 }),
          nodo('a', 'send.text', { text: 'A' }),
          nodo('b', 'send.text', { text: 'B' }),
          nodo('fin', 'control.end'),
        ],
        [
          con('inicio', 'next', 'r'),
          con('r', 'true', 'a'),
          con('r', 'false', 'b'),
          con('a', 'next', 'fin'),
          con('b', 'next', 'fin'),
        ],
      );
      const c = compilado(g);

      const uno = new EfectosFalsos();
      const dos = new EfectosFalsos();
      await avanzar(c, estado({ executionId: 'misma' }), uno);
      await avanzar(c, estado({ executionId: 'misma' }), dos);

      expect(uno.ultimo('enviarTexto')?.texto).toBe(
        dos.ultimo('enviarTexto')?.texto,
      );
    });

    it('ejecuciones distintas pueden caer por ramas distintas', async () => {
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('r', 'control.random', { percent: 50 }),
          nodo('a', 'send.text', { text: 'A' }),
          nodo('b', 'send.text', { text: 'B' }),
          nodo('fin', 'control.end'),
        ],
        [
          con('inicio', 'next', 'r'),
          con('r', 'true', 'a'),
          con('r', 'false', 'b'),
          con('a', 'next', 'fin'),
          con('b', 'next', 'fin'),
        ],
      );
      const c = compilado(g);
      const salidas = new Set<string>();

      for (let i = 0; i < 30; i++) {
        const e = new EfectosFalsos();
        await avanzar(c, estado({ executionId: `ejec-${i}` }), e);
        salidas.add(String(e.ultimo('enviarTexto')?.texto));
      }
      expect(salidas.size).toBe(2);
    });
  });

  describe('idempotencia de efectos', () => {
    it('cada paso lleva una clave distinta, incluso repitiendo nodo', async () => {
      // Sin el numero de paso, la segunda vuelta de un bucle legitimo se
      // tomaria por un reintento de la primera y no haria nada.
      const c = compiladoCrudo([
        {
          id: 'inicio',
          type: 'trigger.inbound_message',
          salidas: { next: 't' },
        },
        {
          id: 't',
          type: 'send.text',
          config: { text: 'Hola' },
          salidas: { next: 'espera' },
        },
        { id: 'espera', type: 'control.wait_duration', config: { seconds: 1 } },
      ]);
      const efectos = new EfectosFalsos();

      const primera = await avanzar(c, estado(), efectos);
      await avanzar(
        c,
        estado({
          currentNodeId: 't',
          steps: primera.steps,
          variables: primera.variables,
        }),
        efectos,
      );

      const claves = efectos.registro
        .filter((e) => e.operacion === 'enviarTexto')
        .map((e) => e.datos.idempotencyKey);
      expect(new Set(claves).size).toBe(claves.length);
    });

    it('la clave de paso incluye ejecución, nodo y número de paso', async () => {
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('t', 'send.text', { text: 'Hola' }),
          nodo('fin', 'control.end'),
        ],
        [con('inicio', 'next', 't'), con('t', 'next', 'fin')],
      );
      const efectos = new EfectosFalsos();
      await avanzar(compilado(g), estado({ executionId: 'ejec-9' }), efectos);

      expect(efectos.ultimo('enviarTexto')?.idempotencyKey).toBe('ejec-9:t:1');
    });
  });

  describe('aislamiento multiempresa', () => {
    it('TODO efecto lleva el companyId de la ejecución', async () => {
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('t', 'send.text', { text: 'Hola' }),
          nodo('lead', 'crm.lead_create', {
            title: 'x',
            pipelineId: 'p1',
            stageId: 's1',
          }),
          nodo('fin', 'control.end'),
        ],
        [
          con('inicio', 'next', 't'),
          con('t', 'next', 'lead'),
          con('lead', 'next', 'fin'),
        ],
      );
      const efectos = new EfectosFalsos();

      await avanzar(compilado(g), estado({ companyId: 'empresa-b' }), efectos);

      const conEmpresa = efectos.registro.filter((e) => 'companyId' in e.datos);
      expect(conEmpresa.length).toBeGreaterThan(0);
      for (const e of conEmpresa) {
        expect(e.datos.companyId).toBe('empresa-b');
      }
    });
  });

  describe('simulación sin efectos reales', () => {
    it('los efectos falsos no devuelven identificadores reales', async () => {
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('lead', 'crm.lead_create', {
            title: 'x',
            pipelineId: 'p1',
            stageId: 's1',
          }),
          nodo('fin', 'control.end'),
        ],
        [con('inicio', 'next', 'lead'), con('lead', 'next', 'fin')],
      );
      const efectos = new EfectosFalsos();

      const r = await avanzar(compilado(g), estado(), efectos);

      // Prefijo `sim-`: si uno acabara en la base por error, se reconoce.
      expect(String((r.variables.lead as Record<string, string>).id)).toMatch(
        /^sim-/,
      );
    });

    it('el nodo HTTP falso NUNCA sale a la red y no anota credenciales', async () => {
      const efectos = new EfectosFalsos();
      await efectos.http.llamar({
        companyId: 'empresa-a',
        url: 'https://api.ejemplo.com',
        metodo: 'POST',
        cabeceras: { Authorization: 'Bearer secreto-de-verdad' },
      });

      const anotado = JSON.stringify(efectos.ultimo('llamar'));
      expect(anotado).not.toContain('secreto-de-verdad');
      expect(anotado).toContain('Authorization');
    });
  });

  describe('IA no configurada', () => {
    it('el motor determinista funciona igual sin proveedor', async () => {
      // La IA es opcional: no puede bloquear los flujos que no la usan.
      const efectos = new EfectosFalsos({ iaDisponible: false });
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('t', 'send.text', { text: 'Hola' }),
          nodo('fin', 'control.end'),
        ],
        [con('inicio', 'next', 't'), con('t', 'next', 'fin')],
      );

      const r = await avanzar(compilado(g), estado(), efectos);

      expect(r.estado).toBe('COMPLETED');
      expect(await efectos.ia.disponible('empresa-a')).toBe(false);
    });
  });

  describe('espera de reintento', () => {
    it('crece con cada intento', () => {
      expect(esperaDeReintento(1, 0)).toBeLessThan(esperaDeReintento(3, 0));
    });

    it('tiene tope, para no esperar horas', () => {
      expect(esperaDeReintento(20, 0)).toBeLessThanOrEqual(5 * 60_000 * 1.2);
    });

    it('lleva dispersión: cien fallos a la vez no reintentan al unísono', () => {
      // Sin dispersion, una caida de Meta produce una avalancha identica al
      // reintentar y vuelve a tumbar lo que se estaba recuperando.
      expect(esperaDeReintento(3, 0)).not.toBe(esperaDeReintento(3, 1));
    });
  });
});
