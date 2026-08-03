import {
  CATALOGO,
  ConexionFlow,
  GrafoFlow,
  LIMITES,
  NodoFlow,
  PUERTO,
  VERSION_ESQUEMA_GRAFO,
  esDisparador,
  esTipoValido,
  puertosDe,
} from './flowbot.graph';
import { variablesDe, VARIABLES_SISTEMA } from './flowbot.variables';

/**
 * Validador del grafo.
 *
 * SU TRABAJO ES QUE NUNCA SE PUBLIQUE ALGO QUE EL MOTOR NO PUEDA EJECUTAR.
 * Un flujo roto no falla en el editor —donde alguien lo vería y lo
 * arreglaría—, falla a mitad de una conversación con un cliente real, que es
 * el peor sitio y el peor momento posibles.
 *
 * Distingue ERRORES de AVISOS: un error impide publicar; un aviso se enseña
 * pero deja seguir, porque hay decisiones legítimas que parecen sospechosas
 * (una rama de error deliberadamente sin conectar, por ejemplo).
 */

export type Severidad = 'error' | 'aviso';

export interface ProblemaGrafo {
  severidad: Severidad;
  /** Código estable, para poder enlazar ayuda o filtrar en pruebas. */
  codigo: string;
  mensaje: string;
  nodeId?: string;
  edgeId?: string;
}

/** Referencias del CRM que el validador puede comprobar contra la empresa. */
export interface ReferenciasEmpresa {
  pipelineIds: Set<string>;
  stageIds: Set<string>;
  userIds: Set<string>;
  templateNames: Set<string>;
  whatsappIntegrationIds: Set<string>;
  credentialIds: Set<string>;
  /** ¿Hay proveedor de IA configurado? */
  iaConfigurada: boolean;
}

export function referenciasVacias(): ReferenciasEmpresa {
  return {
    pipelineIds: new Set(),
    stageIds: new Set(),
    userIds: new Set(),
    templateNames: new Set(),
    whatsappIntegrationIds: new Set(),
    credentialIds: new Set(),
    iaConfigurada: false,
  };
}

const err = (
  codigo: string,
  mensaje: string,
  extra: Partial<ProblemaGrafo> = {},
): ProblemaGrafo => ({ severidad: 'error', codigo, mensaje, ...extra });

const aviso = (
  codigo: string,
  mensaje: string,
  extra: Partial<ProblemaGrafo> = {},
): ProblemaGrafo => ({ severidad: 'aviso', codigo, mensaje, ...extra });

/**
 * Valida el grafo entero.
 *
 * `referencias` es opcional para poder validar en el editor sin consultar la
 * base en cada tecla; al publicar SIEMPRE se pasan, porque una etapa borrada
 * entre el borrador y la publicación es exactamente el caso que rompe una
 * ejecución en marcha.
 */
export function validarGrafo(
  grafo: GrafoFlow,
  referencias?: ReferenciasEmpresa,
): ProblemaGrafo[] {
  const problemas: ProblemaGrafo[] = [];

  // ── forma básica ────────────────────────────────────────────
  if (!grafo || typeof grafo !== 'object') {
    return [err('grafo.invalido', 'El flujo no tiene una forma válida.')];
  }
  if (grafo.schemaVersion !== VERSION_ESQUEMA_GRAFO) {
    problemas.push(
      err(
        'grafo.version',
        `Este flujo usa el formato ${grafo.schemaVersion} y el sistema espera el ${VERSION_ESQUEMA_GRAFO}.`,
      ),
    );
  }
  const nodos = Array.isArray(grafo.nodes) ? grafo.nodes : [];
  const conexiones = Array.isArray(grafo.edges) ? grafo.edges : [];

  if (nodos.length === 0) {
    return [...problemas, err('grafo.vacio', 'El flujo no tiene ningún paso.')];
  }
  if (nodos.length > LIMITES.MAX_NODOS) {
    problemas.push(
      err(
        'grafo.demasiados_nodos',
        `El flujo tiene ${nodos.length} pasos y el máximo es ${LIMITES.MAX_NODOS}.`,
      ),
    );
  }
  if (conexiones.length > LIMITES.MAX_CONEXIONES) {
    problemas.push(
      err(
        'grafo.demasiadas_conexiones',
        `El flujo tiene ${conexiones.length} conexiones y el máximo es ${LIMITES.MAX_CONEXIONES}.`,
      ),
    );
  }

  // ── nodos ───────────────────────────────────────────────────
  const porId = new Map<string, NodoFlow>();
  for (const nodo of nodos) {
    if (!nodo?.id) {
      problemas.push(err('nodo.sin_id', 'Hay un paso sin identificador.'));
      continue;
    }
    if (porId.has(nodo.id)) {
      problemas.push(
        err(
          'nodo.id_repetido',
          `El identificador "${nodo.id}" está repetido.`,
          {
            nodeId: nodo.id,
          },
        ),
      );
      continue;
    }
    if (!esTipoValido(nodo.type)) {
      problemas.push(
        err(
          'nodo.tipo_desconocido',
          `El paso "${nodo.id}" usa un tipo que no existe: ${String(nodo.type)}.`,
          { nodeId: nodo.id },
        ),
      );
      continue;
    }
    porId.set(nodo.id, nodo);
    problemas.push(...validarConfig(nodo, referencias));
  }

  // ── inicio ──────────────────────────────────────────────────
  const inicio = porId.get(grafo.startNodeId);
  if (!grafo.startNodeId || !inicio) {
    problemas.push(
      err('grafo.sin_inicio', 'El flujo no tiene un paso inicial válido.'),
    );
  } else if (!esDisparador(inicio.type)) {
    problemas.push(
      err(
        'grafo.inicio_no_disparador',
        'El paso inicial debe ser un disparador: es lo que decide cuándo arranca el bot.',
        { nodeId: inicio.id },
      ),
    );
  }

  const disparadores = nodos.filter(
    (n) => esTipoValido(n.type) && esDisparador(n.type),
  );
  if (disparadores.length > 1) {
    problemas.push(
      err(
        'grafo.varios_disparadores',
        'Un flujo solo puede tener un disparador. Para otro evento, crea otro bot.',
      ),
    );
  }

  // ── conexiones ──────────────────────────────────────────────
  const salientes = new Map<string, ConexionFlow[]>();
  const entrantes = new Map<string, number>();

  for (const con of conexiones) {
    if (!con?.from || !con?.to) {
      problemas.push(
        err(
          'conexion.incompleta',
          'Hay una conexión sin origen o sin destino.',
          {
            edgeId: con?.id,
          },
        ),
      );
      continue;
    }
    const origen = porId.get(con.from);
    const destino = porId.get(con.to);
    if (!origen) {
      problemas.push(
        err(
          'conexion.origen_inexistente',
          `Una conexión sale de un paso que no existe (${con.from}).`,
          { edgeId: con.id },
        ),
      );
      continue;
    }
    if (!destino) {
      problemas.push(
        err(
          'conexion.destino_inexistente',
          `Una conexión lleva a un paso que no existe (${con.to}).`,
          { edgeId: con.id, nodeId: con.from },
        ),
      );
      continue;
    }
    const puertos = puertosDe(origen);
    if (!puertos.includes(con.fromPort)) {
      problemas.push(
        err(
          'conexion.puerto_inexistente',
          `El paso "${etiqueta(origen)}" no tiene una salida llamada "${con.fromPort}".`,
          { edgeId: con.id, nodeId: origen.id },
        ),
      );
      continue;
    }
    if (!CATALOGO[destino.type].aceptaEntrada) {
      problemas.push(
        err(
          'conexion.destino_no_acepta',
          `"${etiqueta(destino)}" es un disparador: no puede recibir conexiones.`,
          { edgeId: con.id, nodeId: destino.id },
        ),
      );
      continue;
    }

    const lista = salientes.get(con.from) ?? [];
    // Dos conexiones desde el MISMO puerto es ambiguo: el motor tendría que
    // elegir, y elegiría por orden de inserción, es decir, por azar.
    if (lista.some((c) => c.fromPort === con.fromPort)) {
      problemas.push(
        err(
          'conexion.puerto_duplicado',
          `La salida "${con.fromPort}" de "${etiqueta(origen)}" tiene dos destinos.`,
          { edgeId: con.id, nodeId: origen.id },
        ),
      );
      continue;
    }
    lista.push(con);
    salientes.set(con.from, lista);
    entrantes.set(con.to, (entrantes.get(con.to) ?? 0) + 1);
  }

  // ── salidas obligatorias sin conectar ───────────────────────
  for (const nodo of porId.values()) {
    const def = CATALOGO[nodo.type];
    const conectados = new Set(
      (salientes.get(nodo.id) ?? []).map((c) => c.fromPort),
    );
    const puertos = puertosDe(nodo);

    // Un nodo terminal no necesita salidas.
    if (puertos.length === 0) continue;

    // Las salidas de excepción pueden quedar sueltas a propósito: sin
    // conectar, el motor termina la ejecución registrando el motivo. Exigir
    // conectarlas obligaría a dibujar ramas que nadie quiere.
    const opcionales = new Set<string>([
      PUERTO.ERROR,
      PUERTO.TIMEOUT,
      PUERTO.FALLBACK,
    ]);
    const obligatorios = puertos.filter((p) => !opcionales.has(p));

    if (obligatorios.length > 0 && conectados.size === 0) {
      problemas.push(
        err('nodo.sin_salida', `"${etiqueta(nodo)}" no lleva a ningún sitio.`, {
          nodeId: nodo.id,
        }),
      );
      continue;
    }
    for (const puerto of obligatorios) {
      if (!conectados.has(puerto)) {
        problemas.push(
          err(
            'nodo.salida_sin_conectar',
            `La salida "${puerto}" de "${etiqueta(nodo)}" no está conectada.`,
            { nodeId: nodo.id },
          ),
        );
      }
    }
    for (const puerto of puertos.filter((p) => opcionales.has(p))) {
      if (
        !conectados.has(puerto) &&
        def.efectoExterno &&
        puerto === PUERTO.ERROR
      ) {
        problemas.push(
          aviso(
            'nodo.error_sin_rama',
            `"${etiqueta(nodo)}" habla con un servicio externo y no tiene rama de error: si falla, el flujo termina ahí.`,
            { nodeId: nodo.id },
          ),
        );
      }
    }
  }

  // ── alcanzabilidad ──────────────────────────────────────────
  if (inicio) {
    const alcanzados = alcanzablesDesde(inicio.id, salientes);
    for (const nodo of porId.values()) {
      if (!alcanzados.has(nodo.id)) {
        problemas.push(
          aviso(
            'nodo.inalcanzable',
            `"${etiqueta(nodo)}" no se puede alcanzar desde el inicio: nunca se ejecutará.`,
            { nodeId: nodo.id },
          ),
        );
      }
    }

    // ── ciclos sin espera ─────────────────────────────────────
    // Un ciclo NO es un error: reintentar una pregunta hasta que la respuesta
    // valga es un ciclo legítimo. Lo que no puede haber es un ciclo que gire
    // sin esperar nada, porque consume los 200 pasos en milisegundos y
    // bombardea al cliente con mensajes.
    for (const ciclo of ciclosSinEspera(porId, salientes)) {
      problemas.push(
        err(
          'grafo.ciclo_sin_espera',
          `Hay un bucle que no espera nada entre "${ciclo.map((id) => etiqueta(porId.get(id)!)).join('" → "')}". Añade una espera o una pregunta.`,
          { nodeId: ciclo[0] },
        ),
      );
    }

    // ── final alcanzable ──────────────────────────────────────
    const terminales = [...alcanzados].filter((id) => {
      const n = porId.get(id);
      return n && puertosDe(n).length === 0;
    });
    const esperanEntrada = [...alcanzados].some((id) => {
      const n = porId.get(id);
      return n && CATALOGO[n.type].esperaExterna;
    });
    if (terminales.length === 0 && !esperanEntrada) {
      problemas.push(
        aviso(
          'grafo.sin_final',
          'El flujo no llega a ningún paso final. Terminará al agotar el límite de pasos.',
        ),
      );
    }
  }

  // ── variables ───────────────────────────────────────────────
  problemas.push(...validarVariables(nodos, porId));

  // ── IA sin proveedor ────────────────────────────────────────
  if (referencias && !referencias.iaConfigurada) {
    for (const nodo of porId.values()) {
      if (CATALOGO[nodo.type].requiereIA) {
        problemas.push(
          err(
            'nodo.ia_sin_proveedor',
            `"${etiqueta(nodo)}" usa inteligencia artificial y no hay proveedor configurado. Configúralo en Ajustes o sustituye el paso.`,
            { nodeId: nodo.id },
          ),
        );
      }
    }
  }

  return problemas;
}

// ── configuración por nodo ────────────────────────────────────

function validarConfig(
  nodo: NodoFlow,
  referencias?: ReferenciasEmpresa,
): ProblemaGrafo[] {
  const problemas: ProblemaGrafo[] = [];
  const def = CATALOGO[nodo.type];
  const config = nodo.config ?? {};

  for (const campo of def.config) {
    const valor = config[campo.nombre];
    const vacio =
      valor === undefined ||
      valor === null ||
      (typeof valor === 'string' && !valor.trim()) ||
      (Array.isArray(valor) && valor.length === 0);

    if (campo.obligatorio && vacio) {
      problemas.push(
        err(
          'config.obligatoria',
          `Falta "${campo.nombre}" en "${etiqueta(nodo)}".`,
          { nodeId: nodo.id },
        ),
      );
      continue;
    }
    if (vacio) continue;

    if (campo.tipo === 'texto' && typeof valor !== 'string') {
      problemas.push(
        err(
          'config.tipo',
          `"${campo.nombre}" de "${etiqueta(nodo)}" debe ser texto.`,
          {
            nodeId: nodo.id,
          },
        ),
      );
    }
    if (campo.tipo === 'numero' && typeof valor !== 'number') {
      problemas.push(
        err(
          'config.tipo',
          `"${campo.nombre}" de "${etiqueta(nodo)}" debe ser un número.`,
          {
            nodeId: nodo.id,
          },
        ),
      );
    }
    if (campo.tipo === 'lista' && !Array.isArray(valor)) {
      problemas.push(
        err(
          'config.tipo',
          `"${campo.nombre}" de "${etiqueta(nodo)}" debe ser una lista.`,
          {
            nodeId: nodo.id,
          },
        ),
      );
    }
    if (campo.maximo !== undefined) {
      const largo =
        typeof valor === 'string'
          ? valor.length
          : Array.isArray(valor)
            ? valor.length
            : 0;
      if (largo > campo.maximo) {
        problemas.push(
          err(
            'config.demasiado_largo',
            `"${campo.nombre}" de "${etiqueta(nodo)}" pasa del máximo (${campo.maximo}).`,
            { nodeId: nodo.id },
          ),
        );
      }
    }

    // Referencias a entidades de la empresa. Solo se comprueban si nos han
    // dado el inventario: en el editor se valida sin tocar la base.
    if (
      campo.tipo === 'referencia' &&
      referencias &&
      typeof valor === 'string'
    ) {
      const conjunto = conjuntoDe(campo.referencia!, referencias);
      if (conjunto && !conjunto.has(valor)) {
        problemas.push(
          err(
            'config.referencia_inexistente',
            `"${etiqueta(nodo)}" apunta a un ${nombreEntidad(campo.referencia!)} que ya no existe.`,
            { nodeId: nodo.id },
          ),
        );
      }
    }
  }

  // Secretos escritos a mano. Una credencial en el grafo se copia con el bot,
  // viaja en cada exportación y aparece en cualquier volcado.
  problemas.push(...buscarSecretos(nodo));

  // HTTP: solo HTTPS y sin destinos internos. La comprobación de red la hace
  // el propio nodo al ejecutarse; esto corta lo evidente antes de publicar.
  if (nodo.type === 'integration.http') {
    // Si `url` no es texto, `config.tipo` ya lo reporto: convertirlo con
    // String() daria "[object Object]" y se intentaria validar eso como URL.
    const url = typeof config.url === 'string' ? config.url : '';
    problemas.push(...validarUrlHttp(nodo, url));
  }

  return problemas;
}

function conjuntoDe(
  referencia: NonNullable<import('./flowbot.graph').CampoConfig['referencia']>,
  r: ReferenciasEmpresa,
): Set<string> | null {
  switch (referencia) {
    case 'pipeline':
      return r.pipelineIds;
    case 'stage':
      return r.stageIds;
    case 'user':
      return r.userIds;
    case 'template':
      return r.templateNames;
    case 'whatsappIntegration':
      return r.whatsappIntegrationIds;
    case 'credential':
      return r.credentialIds;
    // Etiquetas y campos personalizados son texto libre en este modelo: no
    // hay catálogo cerrado contra el que comprobarlos.
    default:
      return null;
  }
}

function nombreEntidad(referencia: string): string {
  const nombres: Record<string, string> = {
    pipeline: 'pipeline',
    stage: 'etapa',
    user: 'usuario',
    template: 'plantilla',
    whatsappIntegration: 'número de WhatsApp',
    credential: 'credencial',
  };
  return nombres[referencia] ?? referencia;
}

/** Patrones que casi siempre son una credencial pegada donde no debe. */
const PATRONES_SECRETO: Array<{ re: RegExp; que: string }> = [
  { re: /\bBearer\s+[A-Za-z0-9._-]{20,}/, que: 'un token Bearer' },
  { re: /\bsk-[A-Za-z0-9]{20,}/, que: 'una clave de API' },
  { re: /\bEAA[A-Za-z0-9]{20,}/, que: 'un token de Meta' },
  {
    re: /\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/,
    que: 'un JWT',
  },
];

function buscarSecretos(nodo: NodoFlow): ProblemaGrafo[] {
  const problemas: ProblemaGrafo[] = [];
  const visto = new Set<string>();

  const revisar = (valor: unknown) => {
    if (typeof valor === 'string') {
      for (const { re, que } of PATRONES_SECRETO) {
        if (re.test(valor) && !visto.has(que)) {
          visto.add(que);
          problemas.push(
            err(
              'config.secreto_incrustado',
              `"${etiqueta(nodo)}" parece llevar ${que} escrito dentro. Usa una credencial guardada: lo que está en el flujo se copia al clonarlo y aparece en cualquier exportación.`,
              { nodeId: nodo.id },
            ),
          );
        }
      }
      return;
    }
    if (Array.isArray(valor)) {
      valor.forEach(revisar);
      return;
    }
    if (valor && typeof valor === 'object') {
      Object.values(valor as Record<string, unknown>).forEach(revisar);
    }
  };

  revisar(nodo.config);
  return problemas;
}

/** Redes que nunca deben alcanzarse desde un flujo de una empresa. */
const HOSTS_PROHIBIDOS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./, // enlace local: incluye el metadata de las nubes
  /\.internal$/i,
  /\.local$/i,
];

export function validarUrlHttp(nodo: NodoFlow, url: string): ProblemaGrafo[] {
  if (!url.trim()) return [];

  // Las variables se sustituyen por un testigo para poder analizar la forma.
  // Si el testigo NO cae en el host, el destino es literal y se comprueba
  // aquí mismo: dejar pasar `https://evil.com/{{id}}` solo porque lleva una
  // variable en la ruta seria regalar el control del destino.
  const TESTIGO = 'x0variablex0';
  const conTestigo = url.replace(/\{\{[^}]*\}\}/g, TESTIGO);
  const hayVariables = conTestigo !== url;

  let destino: URL;
  try {
    destino = new URL(conTestigo);
  } catch {
    return [
      err(
        'http.url_invalida',
        `La dirección de "${etiqueta(nodo)}" no es válida.`,
        {
          nodeId: nodo.id,
        },
      ),
    ];
  }

  // El esquema nunca depende de una variable: siempre se puede exigir.
  if (destino.protocol !== 'https:') {
    return [
      err(
        'http.no_https',
        `"${etiqueta(nodo)}" debe usar HTTPS: por HTTP el contenido viaja en claro.`,
        { nodeId: nodo.id },
      ),
    ];
  }

  // Credenciales en la propia URL: viajan en logs, historiales y cabeceras
  // de referencia.
  if (destino.username || destino.password) {
    return [
      err(
        'http.credenciales_en_url',
        `"${etiqueta(nodo)}" lleva usuario o contraseña en la dirección. Usa una credencial guardada.`,
        { nodeId: nodo.id },
      ),
    ];
  }

  if (destino.hostname.includes(TESTIGO)) {
    // El host lo decide una variable: solo puede comprobarse al ejecutarse,
    // ya interpolado y con resolución de DNS.
    return [
      aviso(
        'http.url_variable',
        `El destino de "${etiqueta(nodo)}" depende de una variable: se comprobará al ejecutarse.`,
        { nodeId: nodo.id },
      ),
    ];
  }

  if (HOSTS_PROHIBIDOS.some((re) => re.test(destino.hostname))) {
    return [
      err(
        'http.destino_interno',
        `"${etiqueta(nodo)}" apunta a una dirección interna. Desde un flujo solo se pueden llamar servicios públicos.`,
        { nodeId: nodo.id },
      ),
    ];
  }

  return hayVariables
    ? [
        aviso(
          'http.url_variable_ruta',
          `La ruta de "${etiqueta(nodo)}" usa variables. El destino (${destino.hostname}) sí queda comprobado.`,
          { nodeId: nodo.id },
        ),
      ]
    : [];
}

// ── variables ─────────────────────────────────────────────────

function validarVariables(
  nodos: NodoFlow[],
  porId: Map<string, NodoFlow>,
): ProblemaGrafo[] {
  const problemas: ProblemaGrafo[] = [];

  // Lo que existe: variables del sistema más lo que producen los nodos.
  const disponibles = new Set<string>(VARIABLES_SISTEMA);
  for (const nodo of porId.values()) {
    for (const v of CATALOGO[nodo.type].produce ?? []) disponibles.add(v);
    const saveAs = (nodo.config?.saveAs ?? '') as string;
    if (typeof saveAs === 'string' && saveAs.trim()) {
      disponibles.add(`flow.${saveAs.trim()}`);
    }
  }

  for (const nodo of nodos) {
    if (!esTipoValido(nodo.type)) continue;
    for (const usada of variablesDe(nodo.config)) {
      // `flow.*` se acepta siempre que alguien la produzca; el resto debe
      // existir en el catálogo del sistema.
      if (disponibles.has(usada)) continue;
      problemas.push(
        err(
          'variable.inexistente',
          `"${etiqueta(nodo)}" usa {{${usada}}}, que no existe o no se ha guardado antes.`,
          { nodeId: nodo.id },
        ),
      );
    }
  }

  return problemas;
}

// ── recorridos ────────────────────────────────────────────────

function alcanzablesDesde(
  inicio: string,
  salientes: Map<string, ConexionFlow[]>,
): Set<string> {
  const vistos = new Set<string>([inicio]);
  const pila = [inicio];
  while (pila.length) {
    const actual = pila.pop()!;
    for (const con of salientes.get(actual) ?? []) {
      if (!vistos.has(con.to)) {
        vistos.add(con.to);
        pila.push(con.to);
      }
    }
  }
  return vistos;
}

/**
 * Ciclos en los que ningún nodo espera.
 *
 * Se buscan sobre el subgrafo que EXCLUYE los nodos que esperan: si un ciclo
 * pasa por una pregunta o una espera, no puede girar solo. Lo que quede
 * cíclico después de quitarlos gira a máxima velocidad.
 */
function ciclosSinEspera(
  porId: Map<string, NodoFlow>,
  salientes: Map<string, ConexionFlow[]>,
): string[][] {
  const activos = new Set(
    [...porId.values()]
      .filter((n) => !CATALOGO[n.type].esperaExterna)
      .map((n) => n.id),
  );

  const estado = new Map<string, 'visitando' | 'listo'>();
  const pilaActual: string[] = [];
  const ciclos: string[][] = [];

  const visitar = (id: string) => {
    if (!activos.has(id)) return;
    if (estado.get(id) === 'listo') return;
    if (estado.get(id) === 'visitando') {
      const desde = pilaActual.indexOf(id);
      if (desde >= 0) ciclos.push(pilaActual.slice(desde));
      return;
    }
    estado.set(id, 'visitando');
    pilaActual.push(id);
    for (const con of salientes.get(id) ?? []) visitar(con.to);
    pilaActual.pop();
    estado.set(id, 'listo');
  };

  for (const id of activos) visitar(id);

  // Un mismo ciclo puede detectarse por varias entradas: se deduplica por su
  // conjunto de nodos para no repetir el mismo aviso.
  const vistos = new Set<string>();
  return ciclos.filter((c) => {
    const clave = [...c].sort().join('|');
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });
}

function etiqueta(nodo: NodoFlow): string {
  if (nodo.label?.trim()) return nodo.label.trim();
  const def = CATALOGO[nodo.type];
  return def ? def.etiqueta : nodo.id;
}

/** ¿Se puede publicar? Los avisos no bloquean; los errores sí. */
export function sePuedePublicar(problemas: ProblemaGrafo[]): boolean {
  return !problemas.some((p) => p.severidad === 'error');
}
