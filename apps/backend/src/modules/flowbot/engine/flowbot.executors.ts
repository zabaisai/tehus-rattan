import { createHash } from 'crypto';
import {
  dentroDeHorario as dentroDeHorarioEnZona,
  instanteLocal,
  proximaApertura,
} from '../../../common/time/zona-horaria';
import { PUERTO, TipoNodo } from '../graph/flowbot.graph';
import {
  esOperador,
  evaluarCondicion,
  escaparParaInterfaz,
} from '../graph/flowbot.variables';
import {
  ContextoNodo,
  EjecutorNodo,
  ResultadoNodo,
  cancelar,
  claveDePaso,
  continuar,
  esperar,
  fallo,
  handoff,
  terminar,
} from './flowbot.ports';

/**
 * Ejecutores de nodo.
 *
 * Uno por tipo, cada uno una función pura respecto al motor: recibe contexto,
 * devuelve resultado. No conocen Prisma, ni la cola, ni el resto de la
 * aplicación — solo los puertos de efecto que se les pasan.
 *
 * Un nodo NO decide su propio siguiente nodo: devuelve el PUERTO por el que
 * sale y el motor resuelve el destino con el grafo compilado. Así una
 * conexión mal hecha se detecta al publicar y no en ejecución.
 */

const texto = (v: unknown): string => (typeof v === 'string' ? v : '');
const numero = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** Clave estable para un efecto de este paso. */
const clave = (ctx: ContextoNodo, sufijo = ''): string =>
  claveDePaso(ctx.executionId, ctx.nodo.id, ctx.paso) +
  (sufijo ? `:${sufijo}` : '');

// ── disparadores ──────────────────────────────────────────────
// Un disparador ya se evaluó al seleccionar el bot: aquí solo abre paso.

const arrancar: EjecutorNodo = async (ctx) =>
  continuar(PUERTO.SALIDA, {
    message: { text: ctx.entrada ?? '' },
  });

// ── conversación ──────────────────────────────────────────────

/**
 * Comprueba la ventana de servicio ANTES de escribir texto libre.
 *
 * Fuera de ella Meta solo acepta plantillas aprobadas. Intentarlo igualmente
 * produce un rechazo del proveedor, y el cliente se queda sin respuesta sin
 * que nadie sepa por qué. Es mejor salir por la rama de error, que el autor
 * del flujo puede conectar a un envío de plantilla.
 */
async function exigirVentana(ctx: ContextoNodo): Promise<ResultadoNodo | null> {
  if (!ctx.conversationId) {
    return fallo('sin-conversacion', 'configuracion');
  }
  const dentro = await ctx.efectos.mensajeria.dentroDeVentana({
    companyId: ctx.companyId,
    conversationId: ctx.conversationId,
  });
  if (!dentro) {
    return fallo('fuera-de-ventana', 'externo_definitivo', {
      explicacion:
        'Pasaron más de 24 horas desde el último mensaje del cliente: solo se puede escribir con una plantilla aprobada.',
    });
  }
  return null;
}

const enviarTexto: EjecutorNodo = async (ctx) => {
  const bloqueo = await exigirVentana(ctx);
  if (bloqueo) return bloqueo;

  const cuerpo = texto(ctx.config.text);
  if (!cuerpo.trim()) return fallo('texto-vacio', 'configuracion');

  const { wamid } = await ctx.efectos.mensajeria.enviarTexto({
    companyId: ctx.companyId,
    conversationId: ctx.conversationId!,
    texto: cuerpo,
    idempotencyKey: clave(ctx),
  });
  return continuar(PUERTO.SALIDA, undefined, { wamid });
};

const enviarPlantilla: EjecutorNodo = async (ctx) => {
  if (!ctx.conversationId) return fallo('sin-conversacion', 'configuracion');
  const nombre = texto(ctx.config.templateName);
  if (!nombre) return fallo('plantilla-sin-nombre', 'configuracion');

  const params = Array.isArray(ctx.config.params)
    ? ctx.config.params.map((p) => texto(p))
    : [];

  const { wamid } = await ctx.efectos.mensajeria.enviarPlantilla({
    companyId: ctx.companyId,
    conversationId: ctx.conversationId,
    plantilla: nombre,
    parametros: params,
    idempotencyKey: clave(ctx),
  });
  return continuar(PUERTO.SALIDA, undefined, { wamid, plantilla: nombre });
};

const enviarMedio =
  (tipo: 'image' | 'document' | 'audio' | 'video'): EjecutorNodo =>
  async (ctx) => {
    const bloqueo = await exigirVentana(ctx);
    if (bloqueo) return bloqueo;

    const url = texto(ctx.config.url);
    if (!url) return fallo('medio-sin-url', 'configuracion');

    const { wamid } = await ctx.efectos.mensajeria.enviarMedio({
      companyId: ctx.companyId,
      conversationId: ctx.conversationId!,
      tipo,
      url,
      caption: texto(ctx.config.caption) || undefined,
      filename: texto(ctx.config.filename) || undefined,
      idempotencyKey: clave(ctx),
    });
    return continuar(PUERTO.SALIDA, undefined, { wamid });
  };

/** Etiquetas visibles de las opciones de un menú. */
function opcionesDe(config: Record<string, unknown>): string[] {
  const lista = config.options;
  if (!Array.isArray(lista)) return [];
  return lista.map((o) =>
    typeof o === 'string' ? o : texto((o as Record<string, unknown>)?.label),
  );
}

const enviarOpciones =
  (formato: 'buttons' | 'list'): EjecutorNodo =>
  async (ctx) => {
    const bloqueo = await exigirVentana(ctx);
    if (bloqueo) return bloqueo;

    const opciones = opcionesDe(ctx.config);
    if (opciones.length === 0)
      return fallo('menu-sin-opciones', 'configuracion');

    await ctx.efectos.mensajeria.enviarOpciones({
      companyId: ctx.companyId,
      conversationId: ctx.conversationId!,
      texto: texto(ctx.config.text),
      opciones,
      formato,
      idempotencyKey: clave(ctx),
    });

    // Manda y SE QUEDA ESPERANDO: la respuesta llegará como un mensaje nuevo,
    // quizá horas después. La espera es durable, no un temporizador en memoria.
    return esperar({
      kind: 'INPUT',
      wakeAt: vencimiento(ctx, ctx.config.timeoutSeconds),
      timeoutPort: PUERTO.TIMEOUT,
    });
  };

function vencimiento(ctx: ContextoNodo, segundos: unknown): Date | undefined {
  const s = numero(segundos);
  if (s === null || s <= 0) return undefined;
  return new Date(ctx.efectos.reloj.ahora().getTime() + s * 1000);
}

/**
 * Pregunta y espera. Si ya hay entrada, la guarda y sigue.
 *
 * El mismo ejecutor cubre las dos mitades —preguntar y recibir— porque el
 * motor vuelve a llamarlo con `entrada` cuando la espera se reanuda. Tenerlo
 * partido en dos nodos obligaría al autor del flujo a dibujar la mecánica
 * interna del motor.
 */
const preguntar =
  (validar?: (v: string) => { ok: boolean; valor?: string }): EjecutorNodo =>
  async (ctx) => {
    const guardarEn = texto(ctx.config.saveAs);

    if (ctx.entrada !== undefined) {
      const bruto = ctx.entrada.trim();
      const r = validar ? validar(bruto) : { ok: true, valor: bruto };

      if (!r.ok) {
        // Vuelve a preguntar por el mismo nodo. El tope de pasos del motor
        // impide que esto gire para siempre si el cliente nunca acierta.
        return esperar(
          {
            kind: 'INPUT',
            wakeAt: vencimiento(ctx, ctx.config.timeoutSeconds),
            timeoutPort: PUERTO.TIMEOUT,
          },
          { invalido: true },
        );
      }

      const variables = guardarEn
        ? { flow: { [guardarEn]: r.valor ?? bruto } }
        : undefined;
      return continuar(PUERTO.SALIDA, variables);
    }

    const bloqueo = await exigirVentana(ctx);
    if (bloqueo) return bloqueo;

    await ctx.efectos.mensajeria.enviarTexto({
      companyId: ctx.companyId,
      conversationId: ctx.conversationId!,
      texto: texto(ctx.config.text),
      idempotencyKey: clave(ctx, 'pregunta'),
    });

    return esperar({
      kind: 'INPUT',
      wakeAt: vencimiento(ctx, ctx.config.timeoutSeconds),
      timeoutPort: PUERTO.TIMEOUT,
    });
  };

const validarCorreo = (v: string) => ({
  // Deliberadamente laxo: validar correos con precisión es imposible y
  // rechazar uno válido es peor que aceptar uno dudoso, porque deja al cliente
  // atrapado repitiendo.
  ok: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v),
  valor: v.toLowerCase(),
});

const validarTelefono = (v: string) => {
  const digitos = v.replace(/[^\d+]/g, '');
  const soloNumeros = digitos.replace(/\D/g, '');
  if (soloNumeros.length < 7 || soloNumeros.length > 15) return { ok: false };
  return {
    ok: true,
    valor: digitos.startsWith('+') ? digitos : `+${soloNumeros}`,
  };
};

const validarNumero =
  (min?: number | null, max?: number | null) => (v: string) => {
    const limpio = v.replace(/\./g, '').replace(',', '.');
    const n = Number(limpio);
    if (!Number.isFinite(n)) return { ok: false };
    if (min !== null && min !== undefined && n < min) return { ok: false };
    if (max !== null && max !== undefined && n > max) return { ok: false };
    return { ok: true, valor: String(n) };
  };

const validarFecha = (v: string) => {
  const t = Date.parse(v);
  if (Number.isFinite(t)) return { ok: true, valor: new Date(t).toISOString() };
  // Formato colombiano dd/mm/aaaa, que es como lo escribe la gente.
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (!m) return { ok: false };
  const fecha = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return Number.isFinite(fecha.getTime())
    ? { ok: true, valor: fecha.toISOString() }
    : { ok: false };
};

const notaInterna: EjecutorNodo = async (ctx) => {
  if (!ctx.conversationId) return fallo('sin-conversacion', 'configuracion');
  await ctx.efectos.crm.notaInterna({
    companyId: ctx.companyId,
    conversationId: ctx.conversationId,
    // Lo que llega del cliente puede acabar aquí a través de una variable, y
    // esta nota se pinta en el panel del asesor.
    texto: escaparParaInterfaz(texto(ctx.config.text)),
    idempotencyKey: clave(ctx),
  });
  return continuar(PUERTO.SALIDA);
};

const cerrarConversacion: EjecutorNodo = async (ctx) => {
  if (!ctx.conversationId) return fallo('sin-conversacion', 'configuracion');
  await ctx.efectos.crm.cerrarConversacion({
    companyId: ctx.companyId,
    conversationId: ctx.conversationId,
  });
  return continuar(PUERTO.SALIDA);
};

// ── control ───────────────────────────────────────────────────

/** Lee una ruta del contexto de variables, sin bajar por prototipos. */
function leerVariable(
  vars: Readonly<Record<string, unknown>>,
  ruta: string,
): unknown {
  let actual: unknown = vars;
  for (const parte of ruta.split('.')) {
    if (actual === null || typeof actual !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(actual, parte)) return undefined;
    actual = (actual as Record<string, unknown>)[parte];
  }
  return actual;
}

const condicion: EjecutorNodo = async (ctx) => {
  const op = texto(ctx.config.operator);
  if (!esOperador(op)) return fallo('operador-invalido', 'configuracion');

  // `left` ya viene interpolado por el motor: si era `{{flow.x}}`, aquí es su
  // valor. Se compara como texto, que es lo que llega de WhatsApp.
  const resultado = evaluarCondicion(ctx.config.left, op, ctx.config.right);
  return continuar(resultado ? PUERTO.VERDADERO : PUERTO.FALSO, undefined, {
    resultado,
  });
};

const ramas: EjecutorNodo = async (ctx) => {
  const casos = Array.isArray(ctx.config.cases) ? ctx.config.cases : [];
  const izquierda = ctx.config.left;

  for (let i = 0; i < casos.length; i++) {
    const caso = casos[i] as Record<string, unknown>;
    const op = texto(caso?.operator) || 'igual';
    if (!esOperador(op)) continue;
    if (evaluarCondicion(izquierda, op, caso?.value)) {
      return continuar(`caso:${i}`, undefined, { caso: i });
    }
  }
  return continuar(PUERTO.FALLBACK, undefined, { caso: null });
};

const esperarDuracion: EjecutorNodo = async (ctx) => {
  const s = numero(ctx.config.seconds);
  if (s === null || s <= 0) return fallo('espera-invalida', 'configuracion');
  return esperar({
    kind: 'TIME',
    wakeAt: new Date(ctx.efectos.reloj.ahora().getTime() + s * 1000),
  });
};

/**
 * Espera hasta una fecha y hora.
 *
 * LA FECHA SE INTERPRETA EN LA ZONA DE LA EMPRESA. «2026-08-10 14:00»
 * significa las dos de la tarde donde esta el negocio, no en UTC. Sin esto,
 * un recordatorio configurado para las 9 de la manana llegaba a las 4 de la
 * madrugada — y en local nunca se veia, porque el desarrollador y el servidor
 * comparten zona.
 */
const esperarHasta: EjecutorNodo = async (ctx) => {
  const cuando = texto(ctx.config.until);
  const wakeAt = instanteLocal(cuando, ctx.zonaHoraria);
  if (!wakeAt) return fallo('fecha-invalida', 'configuracion');
  // Una fecha ya pasada no es un error: el flujo simplemente sigue.
  if (wakeAt <= ctx.efectos.reloj.ahora()) return continuar(PUERTO.SALIDA);
  return esperar({ kind: 'TIME', wakeAt });
};

/**
 * Horario comercial de la empresa.
 *
 * Tres salidas y no dos. `si` y `no` son las obvias; la tercera —esperar a
 * que abra— es la que convierte un «estamos cerrados» en «te atendemos a
 * primera hora», y sin ella el autor del flujo solo puede disculparse.
 *
 * Una configuracion ilegible NO cierra el negocio: sale por `si`. Un horario
 * con una errata no puede dejar a una empresa sin bot en silencio.
 */
const horarioComercial: EjecutorNodo = async (ctx) => {
  const spec = {
    fromHour: ctx.config.fromHour,
    toHour: ctx.config.toHour,
    days: ctx.config.days,
  };
  const ahora = ctx.efectos.reloj.ahora();
  const dentro = dentroDeHorarioEnZona(ahora, ctx.zonaHoraria, spec);

  if (dentro === null) {
    return continuar(PUERTO.VERDADERO, undefined, { horarioIlegible: true });
  }
  if (dentro) return continuar(PUERTO.VERDADERO);

  if (ctx.config.waitUntilOpen === true) {
    const abre = proximaApertura(ahora, ctx.zonaHoraria, spec);
    // Si nunca abre —dias imposibles— se sale por `no` en vez de dormir para
    // siempre esperando un instante que no va a llegar.
    if (abre) return esperar({ kind: 'TIME', wakeAt: abre });
  }
  return continuar(PUERTO.FALSO);
};

/**
 * Reparto por porcentaje, DETERMINISTA POR EJECUCIÓN.
 *
 * No usa azar real: si el nodo se reintenta tras un fallo, debe caer por la
 * misma rama. Con `Math.random()` un reintento podría enviar al cliente por el
 * otro camino y dejar la conversación incoherente.
 */
const reparto: EjecutorNodo = async (ctx) => {
  const pct = numero(ctx.config.percent);
  if (pct === null || pct < 0 || pct > 100) {
    return fallo('porcentaje-invalido', 'configuracion');
  }
  const semilla = createHash('sha256')
    .update(`${ctx.executionId}:${ctx.nodo.id}`)
    .digest();
  const valor = semilla.readUInt16BE(0) % 100;
  return continuar(valor < pct ? PUERTO.VERDADERO : PUERTO.FALSO, undefined, {
    valor,
  });
};

const saltar: EjecutorNodo = async () =>
  // El destino lo resuelve el motor por el puerto `next`, que el compilador
  // apuntó al nodo elegido. Así un salto a un nodo borrado se detecta al
  // publicar.
  continuar(PUERTO.SALIDA);

const fin: EjecutorNodo = async (ctx) =>
  terminar(texto(ctx.config.reason) || 'fin');
const finCancelado: EjecutorNodo = async (ctx) =>
  cancelar(texto(ctx.config.reason) || 'cancelado');

// ── CRM ───────────────────────────────────────────────────────

const guardarContacto: EjecutorNodo = async (ctx) => {
  const { contactId } = await ctx.efectos.crm.guardarContacto({
    companyId: ctx.companyId,
    contactId: ctx.contactId,
    nombre: texto(ctx.config.name) || undefined,
    email: texto(ctx.config.email) || undefined,
    telefono: texto(ctx.config.phone) || undefined,
    idempotencyKey: clave(ctx),
  });
  return continuar(PUERTO.SALIDA, { contact: { id: contactId } });
};

const etiquetar: EjecutorNodo = async (ctx) => {
  if (!ctx.contactId) return fallo('sin-contacto', 'no_encontrado');
  const accion = texto(ctx.config.action) === 'remove' ? 'remove' : 'add';
  await ctx.efectos.crm.etiquetar({
    companyId: ctx.companyId,
    contactId: ctx.contactId,
    etiqueta: texto(ctx.config.tag),
    accion,
  });
  return continuar(PUERTO.SALIDA);
};

const campoContacto: EjecutorNodo = async (ctx) => {
  if (!ctx.contactId) return fallo('sin-contacto', 'no_encontrado');
  await ctx.efectos.crm.campoPersonalizado({
    companyId: ctx.companyId,
    contactId: ctx.contactId,
    campo: texto(ctx.config.field),
    valor: texto(ctx.config.value),
  });
  return continuar(PUERTO.SALIDA);
};

/**
 * Campo personalizado de la OPORTUNIDAD.
 *
 * Falla si no hay oportunidad en contexto en vez de caer al contacto: guardar
 * "presupuesto aprobado" en la persona lo arrastraria a la siguiente venta,
 * donde ya no es cierto.
 */
const campoOportunidad: EjecutorNodo = async (ctx) => {
  if (!ctx.leadId) return fallo('sin-oportunidad', 'no_encontrado');
  await ctx.efectos.crm.campoOportunidad({
    companyId: ctx.companyId,
    leadId: ctx.leadId,
    campo: texto(ctx.config.field),
    valor: texto(ctx.config.value),
  });
  return continuar(PUERTO.SALIDA);
};

const archivarContacto: EjecutorNodo = async (ctx) => {
  if (!ctx.contactId) return fallo('sin-contacto', 'no_encontrado');
  await ctx.efectos.crm.archivarContacto({
    companyId: ctx.companyId,
    contactId: ctx.contactId,
    motivo: texto(ctx.config.reason) || undefined,
  });
  return continuar(PUERTO.SALIDA);
};

const crearOportunidad: EjecutorNodo = async (ctx) => {
  const { leadId } = await ctx.efectos.crm.crearOportunidad({
    companyId: ctx.companyId,
    contactId: ctx.contactId,
    conversationId: ctx.conversationId,
    titulo: texto(ctx.config.title) || 'Oportunidad',
    pipelineId: texto(ctx.config.pipelineId),
    stageId: texto(ctx.config.stageId),
    valor: numero(ctx.config.value) ?? undefined,
    idempotencyKey: clave(ctx),
  });
  return continuar(PUERTO.SALIDA, { lead: { id: leadId } });
};

const moverEtapa: EjecutorNodo = async (ctx) => {
  if (!ctx.leadId) return fallo('sin-oportunidad', 'no_encontrado');
  await ctx.efectos.crm.moverEtapa({
    companyId: ctx.companyId,
    leadId: ctx.leadId,
    stageId: texto(ctx.config.stageId),
  });
  return continuar(PUERTO.SALIDA);
};

const valorOportunidad: EjecutorNodo = async (ctx) => {
  if (!ctx.leadId) return fallo('sin-oportunidad', 'no_encontrado');
  const v = numero(ctx.config.value);
  if (v === null) return fallo('valor-invalido', 'configuracion');
  await ctx.efectos.crm.valorOportunidad({
    companyId: ctx.companyId,
    leadId: ctx.leadId,
    valor: v,
  });
  return continuar(PUERTO.SALIDA);
};

const asignar: EjecutorNodo = async (ctx) => {
  if (!ctx.leadId) return fallo('sin-oportunidad', 'no_encontrado');
  await ctx.efectos.crm.asignar({
    companyId: ctx.companyId,
    leadId: ctx.leadId,
    userId: texto(ctx.config.userId),
  });
  return continuar(PUERTO.SALIDA);
};

const asignarPorTurno: EjecutorNodo = async (ctx) => {
  const turno = await ctx.efectos.crm.siguienteEnTurno({
    companyId: ctx.companyId,
    conversationId: ctx.conversationId,
  });
  if (!turno) {
    // Sin nadie disponible NO se falla: el flujo sigue sin responsable, que es
    // mejor que cortar la conversación del cliente.
    return continuar(PUERTO.SALIDA, undefined, { sinAsesores: true });
  }
  if (ctx.leadId) {
    await ctx.efectos.crm.asignar({
      companyId: ctx.companyId,
      leadId: ctx.leadId,
      userId: turno.userId,
    });
  }
  return continuar(PUERTO.SALIDA, {
    agent: { id: turno.userId, name: turno.nombre },
  });
};

const cerrarOportunidad: EjecutorNodo = async (ctx) => {
  if (!ctx.leadId) return fallo('sin-oportunidad', 'no_encontrado');
  const resultado =
    texto(ctx.config.result) === 'perdida' ? 'perdida' : 'ganada';
  await ctx.efectos.crm.cerrarOportunidad({
    companyId: ctx.companyId,
    leadId: ctx.leadId,
    resultado,
    motivo: texto(ctx.config.reason) || undefined,
  });
  return continuar(PUERTO.SALIDA);
};

/** Lo comun a crear y a proponer: no hay dos formas de leer la configuracion. */
function datosDeTarea(ctx: Parameters<EjecutorNodo>[0]) {
  const horas = numero(ctx.config.dueInHours);
  return {
    companyId: ctx.companyId,
    titulo: texto(ctx.config.title) || 'Tarea del bot',
    conversationId: ctx.conversationId,
    contactId: ctx.contactId,
    leadId: ctx.leadId,
    assignedTo: texto(ctx.config.assignedTo) || undefined,
    venceEn:
      horas !== null
        ? new Date(ctx.efectos.reloj.ahora().getTime() + horas * 3600_000)
        : undefined,
    prioridad: texto(ctx.config.priority) || undefined,
    idempotencyKey: clave(ctx),
    flowBotId: ctx.flowBotId ?? null,
    motivo: texto(ctx.config.reason) || undefined,
  };
}

/**
 * Crear tarea.
 *
 * Si la empresa exige aprobacion —lo predeterminado— esto acaba en una
 * PROPUESTA, no en una tarea. El bot no puede meter trabajo en la lista de una
 * persona sin que esa persona lo acepte.
 */
const crearTarea: EjecutorNodo = async (ctx) => {
  const r = await ctx.efectos.crm.crearTarea(datosDeTarea(ctx));
  return continuar(PUERTO.SALIDA, {
    task: { id: r.taskId },
    suggestion: { id: r.suggestionId, propuesta: r.propuesta },
  });
};

/**
 * Sugerir tarea. SIEMPRE propone, sin depender del ajuste de la empresa.
 *
 * Existe aparte de «Crear tarea» para que el autor del bot pueda decir «esto
 * lo revisa alguien» de forma explicita en el propio flujo.
 */
const sugerirTarea: EjecutorNodo = async (ctx) => {
  const { suggestionId } = await ctx.efectos.crm.sugerirTarea(
    datosDeTarea(ctx),
  );
  return continuar(PUERTO.SALIDA, {
    suggestion: { id: suggestionId, propuesta: true },
  });
};

const transferir: EjecutorNodo = async (ctx) => {
  if (!ctx.conversationId) return fallo('sin-conversacion', 'configuracion');
  const motivo =
    texto(ctx.config.reason) || 'El bot pasó la conversación a una persona';
  await ctx.efectos.crm.transferir({
    companyId: ctx.companyId,
    conversationId: ctx.conversationId,
    userId: texto(ctx.config.assignedTo) || undefined,
    motivo,
    nota: texto(ctx.config.note) || undefined,
    // QUE nodo lo decidio. Un flujo con tres salidas a persona por motivos
    // distintos es indistinguible sin esto, y es la primera pregunta de quien
    // revisa por que se entrego una conversacion.
    nodeId: ctx.nodo.id,
  });
  return handoff(motivo);
};

/**
 * Llamada HTTP a un servicio externo.
 *
 * El ejecutor es corto a proposito: TODA la seguridad —HTTPS, lista de
 * destinos, DNS, redirecciones, tiempo limite, tope de respuesta,
 * credenciales— vive en el adaptador. Un nodo no puede relajarla porque no la
 * conoce.
 *
 * `saveAs` guarda la respuesta en las variables del flujo. Se guarda el CUERPO
 * ya interpretado, no el objeto de respuesta entero: las cabeceras de una
 * respuesta pueden traer cookies de sesion del servicio externo.
 */
const llamarHttp: EjecutorNodo = async (ctx) => {
  const url = texto(ctx.config.url);
  if (!url) return fallo('http-sin-url', 'configuracion');

  const { estado, datos } = await ctx.efectos.http.llamar({
    companyId: ctx.companyId,
    url,
    metodo: texto(ctx.config.method) || 'GET',
    cabeceras:
      ctx.config.headers && typeof ctx.config.headers === 'object'
        ? (ctx.config.headers as Record<string, string>)
        : undefined,
    cuerpo: ctx.config.body,
    credentialId: texto(ctx.config.credentialId) || undefined,
  });

  const guardarEn = texto(ctx.config.saveAs);
  return continuar(
    PUERTO.SALIDA,
    guardarEn ? { flow: { [guardarEn]: datos } } : undefined,
    // En el paso solo el codigo: el cuerpo puede traer datos del cliente y el
    // historial de pasos se lee desde soporte.
    { estado },
  );
};

// ── registro ──────────────────────────────────────────────────

/**
 * Qué ejecutor atiende cada tipo.
 *
 * Los tipos sin entrada aquí todavía no están implementados: el motor los
 * trata como error de configuración en vez de saltárselos en silencio, porque
 * un nodo que no hace nada y deja pasar es indistinguible de uno que funciona.
 */
export const EJECUTORES: Partial<Record<TipoNodo, EjecutorNodo>> = {
  'trigger.inbound_message': arrancar,
  'trigger.keyword': arrancar,
  'trigger.conversation_created': arrancar,
  'trigger.stage_changed': arrancar,
  'trigger.schedule': arrancar,
  'trigger.manual': arrancar,

  'send.text': enviarTexto,
  'send.template': enviarPlantilla,
  'send.image': enviarMedio('image'),
  'send.document': enviarMedio('document'),
  'send.audio': enviarMedio('audio'),
  'send.video': enviarMedio('video'),
  'send.buttons': enviarOpciones('buttons'),
  'send.list': enviarOpciones('list'),

  'ask.question': preguntar(),
  'ask.email': preguntar(validarCorreo),
  'ask.phone': preguntar(validarTelefono),
  'ask.date': preguntar(validarFecha),

  'conversation.note': notaInterna,
  'conversation.close': cerrarConversacion,

  'control.condition': condicion,
  'control.switch': ramas,
  'control.wait_duration': esperarDuracion,
  'control.wait_until': esperarHasta,
  'control.business_hours': horarioComercial,
  'control.random': reparto,
  'control.jump': saltar,
  'control.end': fin,
  'control.cancel': finCancelado,

  'integration.http': llamarHttp,

  'crm.contact_upsert': guardarContacto,
  'crm.contact_tag': etiquetar,
  'crm.contact_field': campoContacto,
  'crm.lead_field': campoOportunidad,
  'crm.contact_archive': archivarContacto,
  'crm.lead_create': crearOportunidad,
  'crm.lead_stage': moverEtapa,
  'crm.lead_value': valorOportunidad,
  'crm.lead_assign': asignar,
  'crm.lead_assign_round_robin': asignarPorTurno,
  'crm.lead_close': cerrarOportunidad,
  'crm.task_create': crearTarea,
  'crm.task_suggest': sugerirTarea,
  'crm.handoff': transferir,
};

/** `ask.number` necesita su configuración para construir el validador. */
export function ejecutorDe(
  tipo: TipoNodo,
  config: Record<string, unknown>,
): EjecutorNodo | null {
  if (tipo === 'ask.number') {
    return preguntar(validarNumero(numero(config.min), numero(config.max)));
  }
  return EJECUTORES[tipo] ?? null;
}

export { leerVariable };
