import { GrafoFlow, NodoFlow, ConexionFlow } from './flowbot.graph';
import {
  ReferenciasEmpresa,
  referenciasVacias,
  sePuedePublicar,
  validarGrafo,
} from './flowbot.validator';
import { compilar, grafoInicial, siguiente } from './flowbot.compiler';

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

const grafo = (
  nodes: NodoFlow[],
  edges: ConexionFlow[] = [],
  start = 'inicio',
): GrafoFlow => ({
  schemaVersion: 1,
  startNodeId: start,
  nodes,
  edges,
});

const codigos = (g: GrafoFlow, r?: ReferenciasEmpresa) =>
  validarGrafo(g, r).map((p) => p.codigo);

const errores = (g: GrafoFlow, r?: ReferenciasEmpresa) =>
  validarGrafo(g, r)
    .filter((p) => p.severidad === 'error')
    .map((p) => p.codigo);

/** Flujo mínimo válido: disparador → mensaje → fin. */
const flujoValido = () =>
  grafo(
    [
      nodo('inicio', 'trigger.inbound_message'),
      nodo('saluda', 'send.text', { text: 'Hola' }),
      nodo('fin', 'control.end'),
    ],
    [con('inicio', 'next', 'saluda'), con('saluda', 'next', 'fin')],
  );

const referencias = (
  extra: Partial<ReferenciasEmpresa> = {},
): ReferenciasEmpresa => ({
  ...referenciasVacias(),
  iaConfigurada: true,
  ...extra,
});

// ── pruebas ───────────────────────────────────────────────────

describe('validador de grafos de FlowBot', () => {
  it('un flujo mínimo válido no produce errores', () => {
    expect(errores(flujoValido())).toEqual([]);
    expect(sePuedePublicar(validarGrafo(flujoValido()))).toBe(true);
  });

  describe('forma del grafo', () => {
    it('rechaza un grafo vacío', () => {
      expect(errores(grafo([]))).toContain('grafo.vacio');
    });

    it('rechaza un formato de esquema desconocido', () => {
      const g = { ...flujoValido(), schemaVersion: 99 };
      expect(errores(g)).toContain('grafo.version');
    });

    it('rechaza identificadores repetidos', () => {
      const g = grafo([
        nodo('inicio', 'trigger.inbound_message'),
        nodo('inicio', 'control.end'),
      ]);
      expect(errores(g)).toContain('nodo.id_repetido');
    });

    it('rechaza un tipo de nodo que no existe', () => {
      const g = grafo([nodo('inicio', 'no.existe' as never)]);
      expect(errores(g)).toContain('nodo.tipo_desconocido');
    });
  });

  describe('inicio', () => {
    it('exige un paso inicial', () => {
      const g = grafo([nodo('a', 'send.text', { text: 'x' })], [], 'no-existe');
      expect(errores(g)).toContain('grafo.sin_inicio');
    });

    it('el inicio debe ser un disparador', () => {
      const g = grafo(
        [
          nodo('inicio', 'send.text', { text: 'x' }),
          nodo('fin', 'control.end'),
        ],
        [con('inicio', 'next', 'fin')],
      );
      expect(errores(g)).toContain('grafo.inicio_no_disparador');
    });

    it('un flujo no puede tener dos disparadores', () => {
      // Dos disparadores en un mismo flujo dejarian sin definir cual manda.
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('otro', 'trigger.keyword', { keywords: ['hola'] }),
          nodo('fin', 'control.end'),
        ],
        [con('inicio', 'next', 'fin')],
      );
      expect(errores(g)).toContain('grafo.varios_disparadores');
    });
  });

  describe('conexiones', () => {
    it('detecta una conexión a un paso que no existe', () => {
      const g = grafo(
        [nodo('inicio', 'trigger.inbound_message')],
        [con('inicio', 'next', 'fantasma')],
      );
      expect(errores(g)).toContain('conexion.destino_inexistente');
    });

    it('detecta un puerto que el nodo no tiene', () => {
      const g = grafo(
        [nodo('inicio', 'trigger.inbound_message'), nodo('fin', 'control.end')],
        [con('inicio', 'puerto_inventado', 'fin')],
      );
      expect(errores(g)).toContain('conexion.puerto_inexistente');
    });

    it('un disparador no puede recibir conexiones', () => {
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('t', 'send.text', { text: 'x' }),
        ],
        [con('inicio', 'next', 't'), con('t', 'next', 'inicio')],
      );
      expect(errores(g)).toContain('conexion.destino_no_acepta');
    });

    it('un mismo puerto no puede tener dos destinos', () => {
      // El motor tendria que elegir, y elegiria por orden de insercion: azar.
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('a', 'control.end'),
          nodo('b', 'control.end'),
        ],
        [con('inicio', 'next', 'a'), con('inicio', 'next', 'b')],
      );
      expect(errores(g)).toContain('conexion.puerto_duplicado');
    });
  });

  describe('salidas sin conectar', () => {
    it('una condición con solo una rama es un error', () => {
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('si', 'control.condition', {
            left: '{{message.text}}',
            operator: 'contiene',
            right: 'hola',
          }),
          nodo('fin', 'control.end'),
        ],
        [con('inicio', 'next', 'si'), con('si', 'true', 'fin')],
      );
      expect(errores(g)).toContain('nodo.salida_sin_conectar');
    });

    it('la rama de error puede quedar suelta: solo avisa', () => {
      // Exigir conectarla obligaria a dibujar ramas que nadie quiere.
      const problemas = validarGrafo(flujoValido());
      expect(problemas.filter((p) => p.severidad === 'error')).toEqual([]);
      expect(problemas.map((p) => p.codigo)).toContain('nodo.error_sin_rama');
    });

    it('un nodo sin ninguna salida conectada es un error', () => {
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('t', 'send.text', { text: 'x' }),
        ],
        [con('inicio', 'next', 't')],
      );
      expect(errores(g)).toContain('nodo.sin_salida');
    });
  });

  describe('alcanzabilidad', () => {
    it('avisa de un paso al que no se puede llegar', () => {
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('fin', 'control.end'),
          nodo('huerfano', 'control.end'),
        ],
        [con('inicio', 'next', 'fin')],
      );
      expect(codigos(g)).toContain('nodo.inalcanzable');
      // Es aviso, no error: un paso suelto a medio construir no debe impedir
      // guardar ni publicar el resto.
      expect(errores(g)).not.toContain('nodo.inalcanzable');
    });
  });

  describe('ciclos', () => {
    it('RECHAZA un bucle que no espera nada', () => {
      // Giraria a maxima velocidad, consumiendo el tope de pasos en
      // milisegundos y bombardeando al cliente con mensajes.
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('a', 'send.text', { text: 'hola' }),
          nodo('b', 'send.text', { text: 'otra vez' }),
        ],
        [
          con('inicio', 'next', 'a'),
          con('a', 'next', 'b'),
          con('b', 'next', 'a'),
        ],
      );
      expect(errores(g)).toContain('grafo.ciclo_sin_espera');
    });

    it('PERMITE un bucle que pasa por una pregunta', () => {
      // Reintentar hasta que la respuesta valga es un ciclo legitimo: no puede
      // girar solo porque espera al cliente en cada vuelta.
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('pide', 'ask.email', { text: 'Tu correo?', saveAs: 'correo' }),
          nodo('valida', 'control.condition', {
            left: '{{flow.correo}}',
            operator: 'contiene',
            right: '@',
          }),
          nodo('fin', 'control.end'),
        ],
        [
          con('inicio', 'next', 'pide'),
          con('pide', 'next', 'valida'),
          con('valida', 'true', 'fin'),
          con('valida', 'false', 'pide'),
        ],
      );
      expect(errores(g)).not.toContain('grafo.ciclo_sin_espera');
    });

    it('permite un bucle que pasa por una espera', () => {
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('espera', 'control.wait_duration', { seconds: 3600 }),
          nodo('recuerda', 'send.text', { text: 'Sigues ahi?' }),
        ],
        [
          con('inicio', 'next', 'espera'),
          con('espera', 'next', 'recuerda'),
          con('recuerda', 'next', 'espera'),
        ],
      );
      expect(errores(g)).not.toContain('grafo.ciclo_sin_espera');
    });
  });

  describe('configuración', () => {
    it('detecta un campo obligatorio ausente', () => {
      const g = grafo(
        [nodo('inicio', 'trigger.inbound_message'), nodo('t', 'send.text', {})],
        [con('inicio', 'next', 't')],
      );
      expect(errores(g)).toContain('config.obligatoria');
    });

    it('detecta un tipo equivocado', () => {
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('w', 'control.wait_duration', { seconds: 'mucho' }),
          nodo('fin', 'control.end'),
        ],
        [con('inicio', 'next', 'w'), con('w', 'next', 'fin')],
      );
      expect(errores(g)).toContain('config.tipo');
    });

    it('detecta un texto que pasa del máximo', () => {
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('t', 'send.text', { text: 'x'.repeat(5000) }),
          nodo('fin', 'control.end'),
        ],
        [con('inicio', 'next', 't'), con('t', 'next', 'fin')],
      );
      expect(errores(g)).toContain('config.demasiado_largo');
    });
  });

  describe('referencias a entidades de la empresa', () => {
    it('rechaza una etapa que ya no existe', () => {
      // Es el caso que rompe una ejecucion en marcha: la etapa se borro entre
      // el borrador y la publicacion.
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('lead', 'crm.lead_create', {
            title: 'Nueva',
            pipelineId: 'p1',
            stageId: 'borrada',
          }),
          nodo('fin', 'control.end'),
        ],
        [con('inicio', 'next', 'lead'), con('lead', 'next', 'fin')],
      );
      const refs = referencias({
        pipelineIds: new Set(['p1']),
        stageIds: new Set(['s1']),
      });
      expect(errores(g, refs)).toContain('config.referencia_inexistente');
    });

    it('acepta una referencia que sí existe', () => {
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('lead', 'crm.lead_create', {
            title: 'Nueva',
            pipelineId: 'p1',
            stageId: 's1',
          }),
          nodo('fin', 'control.end'),
        ],
        [con('inicio', 'next', 'lead'), con('lead', 'next', 'fin')],
      );
      const refs = referencias({
        pipelineIds: new Set(['p1']),
        stageIds: new Set(['s1']),
      });
      expect(errores(g, refs)).not.toContain('config.referencia_inexistente');
    });

    it('sin inventario de referencias no se comprueban: el editor valida sin tocar la base', () => {
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('lead', 'crm.lead_create', {
            title: 'x',
            pipelineId: 'lo-que-sea',
            stageId: 'lo-que-sea',
          }),
          nodo('fin', 'control.end'),
        ],
        [con('inicio', 'next', 'lead'), con('lead', 'next', 'fin')],
      );
      expect(errores(g)).not.toContain('config.referencia_inexistente');
    });
  });

  describe('secretos incrustados', () => {
    it.each([
      ['Bearer', 'Bearer abcdefghijklmnopqrstuvwxyz012345'],
      ['clave de API', 'sk-abcdefghijklmnopqrstuvwxyz0123'],
      ['token de Meta', 'EAAabcdefghijklmnopqrstuvwxyz0123'],
    ])('detecta %s escrito en la configuración', (_, valor) => {
      // Lo que esta en el grafo se copia al clonarlo y aparece en cualquier
      // exportacion.
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('http', 'integration.http', {
            url: 'https://api.ejemplo.com/x',
            method: 'GET',
            headers: { Authorization: valor },
          }),
          nodo('fin', 'control.end'),
        ],
        [con('inicio', 'next', 'http'), con('http', 'next', 'fin')],
      );
      expect(errores(g)).toContain('config.secreto_incrustado');
    });
  });

  describe('nodo HTTP', () => {
    const conUrl = (url: string) =>
      grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('http', 'integration.http', { url, method: 'GET' }),
          nodo('fin', 'control.end'),
        ],
        [con('inicio', 'next', 'http'), con('http', 'next', 'fin')],
      );

    it('exige HTTPS', () => {
      expect(errores(conUrl('http://api.ejemplo.com'))).toContain(
        'http.no_https',
      );
    });

    it.each([
      'https://localhost/x',
      'https://127.0.0.1/x',
      'https://10.0.0.5/x',
      'https://192.168.1.10/x',
      'https://172.16.0.1/x',
      'https://169.254.169.254/latest/meta-data',
      'https://algo.internal/x',
    ])('bloquea el destino interno %s', (url) => {
      expect(errores(conUrl(url))).toContain('http.destino_interno');
    });

    it('acepta un destino público por HTTPS', () => {
      expect(errores(conUrl('https://api.ejemplo.com/v1'))).toEqual([]);
    });

    it('si el HOST es una variable, se difiere a la ejecución', () => {
      // Solo entonces se puede resolver el destino real y su DNS.
      const g = conUrl('https://{{contact.phone}}.ejemplo.com/x');
      const problemas = validarGrafo(g);
      expect(problemas.map((p) => p.codigo)).toContain('http.url_variable');
      expect(problemas.filter((p) => p.severidad === 'error')).toEqual([]);
    });

    it('si SOLO la ruta lleva variables, el host SÍ se comprueba al publicar', () => {
      // Dejar pasar `https://evil.com/{{id}}` solo porque lleva una variable
      // en la ruta seria regalar el control del destino.
      expect(errores(conUrl('https://10.0.0.5/{{contact.phone}}'))).toContain(
        'http.destino_interno',
      );
      const bueno = validarGrafo(
        conUrl('https://api.ejemplo.com/{{contact.phone}}'),
      );
      expect(bueno.filter((p) => p.severidad === 'error')).toEqual([]);
      expect(bueno.map((p) => p.codigo)).toContain('http.url_variable_ruta');
    });

    it('rechaza credenciales escritas en la propia dirección', () => {
      // Viajan en logs, historiales y cabeceras de referencia.
      expect(
        errores(conUrl('https://usuario:clave@api.ejemplo.com/x')),
      ).toContain('http.credenciales_en_url');
    });
  });

  describe('variables', () => {
    it('rechaza una variable que nadie produce', () => {
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('t', 'send.text', { text: 'Hola {{flow.inventada}}' }),
          nodo('fin', 'control.end'),
        ],
        [con('inicio', 'next', 't'), con('t', 'next', 'fin')],
      );
      expect(errores(g)).toContain('variable.inexistente');
    });

    it('acepta una variable guardada antes por una pregunta', () => {
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('pide', 'ask.question', {
            text: 'Tu nombre?',
            saveAs: 'nombre',
          }),
          nodo('saluda', 'send.text', { text: 'Hola {{flow.nombre}}' }),
          nodo('fin', 'control.end'),
        ],
        [
          con('inicio', 'next', 'pide'),
          con('pide', 'next', 'saluda'),
          con('saluda', 'next', 'fin'),
        ],
      );
      expect(errores(g)).not.toContain('variable.inexistente');
    });

    it('acepta las variables del sistema', () => {
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('t', 'send.text', {
            text: 'Hola {{contact.name}}, de {{company.name}}',
          }),
          nodo('fin', 'control.end'),
        ],
        [con('inicio', 'next', 't'), con('t', 'next', 'fin')],
      );
      expect(errores(g)).not.toContain('variable.inexistente');
    });
  });

  describe('IA sin proveedor', () => {
    const conIA = () =>
      grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('ia', 'ai.summarize', {}),
          nodo('fin', 'control.end'),
        ],
        [con('inicio', 'next', 'ia'), con('ia', 'next', 'fin')],
      );

    it('impide publicar un flujo con IA si no hay proveedor', () => {
      const refs = referencias({ iaConfigurada: false });
      expect(errores(conIA(), refs)).toContain('nodo.ia_sin_proveedor');
    });

    it('lo permite cuando sí lo hay', () => {
      expect(errores(conIA(), referencias())).not.toContain(
        'nodo.ia_sin_proveedor',
      );
    });

    it('un flujo SIN IA se publica igual aunque no haya proveedor', () => {
      // La IA es opcional: no puede bloquear los flujos deterministas.
      const refs = referencias({ iaConfigurada: false });
      expect(errores(flujoValido(), refs)).toEqual([]);
    });
  });

  describe('menús con puertos dinámicos', () => {
    it('un menú genera un puerto por opción', () => {
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('menu', 'send.buttons', {
            text: 'Elige',
            options: [{ label: 'A' }, { label: 'B' }],
          }),
          nodo('a', 'control.end'),
          nodo('b', 'control.end'),
        ],
        [
          con('inicio', 'next', 'menu'),
          con('menu', 'opcion:0', 'a'),
          con('menu', 'opcion:1', 'b'),
        ],
      );
      expect(errores(g)).toEqual([]);
    });

    it('conectar una opción que no existe es un error', () => {
      const g = grafo(
        [
          nodo('inicio', 'trigger.inbound_message'),
          nodo('menu', 'send.buttons', {
            text: 'Elige',
            options: [{ label: 'A' }],
          }),
          nodo('a', 'control.end'),
        ],
        [con('inicio', 'next', 'menu'), con('menu', 'opcion:5', 'a')],
      );
      expect(errores(g)).toContain('conexion.puerto_inexistente');
    });
  });
});

describe('compilador', () => {
  it('no compila un grafo con errores', () => {
    const r = compilar(grafo([]));
    expect(r.ok).toBe(false);
    expect(r.compilado).toBeUndefined();
  });

  it('compila un grafo válido y resuelve las salidas', () => {
    const r = compilar(flujoValido());
    expect(r.ok).toBe(true);
    expect(r.compilado!.nodos['saluda'].salidas).toEqual({ next: 'fin' });
    expect(r.compilado!.triggerType).toBe('trigger.inbound_message');
  });

  it('la huella es estable entre compilaciones del mismo grafo', () => {
    // Sin ordenar las claves, dos compilaciones darian huellas distintas solo
    // por el orden de insercion y la huella no serviria para comparar.
    expect(compilar(flujoValido()).hash).toBe(compilar(flujoValido()).hash);
  });

  it('la huella cambia si cambia el grafo', () => {
    const otro = flujoValido();
    (otro.nodes[1].config as Record<string, unknown>).text = 'Buenas';
    expect(compilar(otro).hash).not.toBe(compilar(flujoValido()).hash);
  });

  it('`siguiente` resuelve el destino por puerto', () => {
    const { compilado } = compilar(flujoValido());
    expect(siguiente(compilado!, 'saluda', 'next')?.id).toBe('fin');
    expect(siguiente(compilado!, 'saluda', 'error')).toBeNull();
  });

  it('el grafo inicial de un bot nuevo es coherente', () => {
    const g = grafoInicial();
    expect(g.startNodeId).toBe('inicio');
    // Aun no se puede publicar: falta que lleve a algun sitio. Eso es
    // correcto — un bot recien creado no deberia poder activarse.
    expect(sePuedePublicar(validarGrafo(g))).toBe(false);
  });
});
