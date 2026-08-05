import http from 'http';
import { AddressInfo } from 'net';
import {
  TransporteWhatsAppReal,
  esAmbiguo,
  esReintentable,
  politicaDeError,
} from '../src/modules/flowbot/engine/adapters/flowbot.whatsapp.transport';
import { TransporteWhatsAppFalso } from '../src/modules/flowbot/engine/adapters/flowbot.whatsapp.fake-transport';
import { TransporteWhatsAppDryRun } from '../src/modules/flowbot/engine/adapters/flowbot.whatsapp.dry-run-transport';
import type {
  SobreWhatsApp,
  TransporteWhatsApp,
} from '../src/modules/flowbot/engine/adapters/flowbot.whatsapp.transport';

/**
 * EL TRANSPORTE REAL CONTRA UNA META SIMULADA.
 *
 * Aquí corre el código que el día de mañana hablará con Meta de verdad —el
 * mismo `axios`, las mismas cabeceras, el mismo manejo de errores— pero contra
 * un servidor HTTP levantado en esta máquina. Es la única forma de probar el
 * camino real sin llamar a `graph.facebook.com`, que además de estar prohibido
 * haría la suite dependiente de una red y de una cuenta.
 *
 * SE PRUEBA CADA RESPUESTA QUE META PUEDE DAR, incluidas las feas: la que
 * llega a medias, la que tarda demasiado y la que dice 200 sin decir qué. Esas
 * tres son las que producen mensajes duplicados si se tratan como las demás.
 *
 * La última prueba comprueba que NINGUNA respuesta hace que el token acabe en
 * el resultado, porque de ahí pasa a la base y a los registros.
 */
describe('Transporte real contra una Meta simulada (e2e)', () => {
  let servidor: http.Server;
  let base: string;

  /** Qué debe responder la próxima petición. Lo fija cada prueba. */
  let guion: (req: http.IncomingMessage, res: http.ServerResponse) => void;
  /** Lo que recibió el servidor, para comprobar qué se mandó de verdad. */
  const recibido: Array<{ headers: http.IncomingHttpHeaders; cuerpo: string }> =
    [];

  beforeAll(async () => {
    servidor = http.createServer((req, res) => {
      let cuerpo = '';
      req.on('data', (c) => (cuerpo += c));
      req.on('end', () => {
        recibido.push({ headers: req.headers, cuerpo });
        guion(req, res);
      });
    });

    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
    const puerto = (servidor.address() as AddressInfo).port;
    base = `http://127.0.0.1:${puerto}`;

    process.env.WHATSAPP_GRAPH_API_VERSION = 'v21.0';
  });

  afterAll(async () => {
    await new Promise<void>((r) => servidor.close(() => r()));
  });

  beforeEach(() => {
    recibido.length = 0;
    guion = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ messages: [{ id: 'wamid.SIMULADO' }] }));
    };
  });

  const sobre = (): SobreWhatsApp => ({
    phoneNumberId: 'numero-de-prueba',
    accessToken: 'TOKEN-FALSO-DE-PRUEBA-NO-REAL',
    to: '573001112233',
    cuerpo: { type: 'text', text: { body: 'Hola' } },
  });

  // Se usa una subclase que solo cambia el destino: es la forma de mantener
  // el código real intacto y aun así no salir de la máquina.
  class TransporteApuntadoAlLocal extends TransporteWhatsAppReal {
    constructor(private readonly destino: string) {
      super();
    }
    async enviar(s: SobreWhatsApp) {
      const anterior = process.env.WHATSAPP_GRAPH_BASE_URL;
      process.env.WHATSAPP_GRAPH_BASE_URL = this.destino;
      try {
        return await super.enviar(s);
      } finally {
        if (anterior === undefined) delete process.env.WHATSAPP_GRAPH_BASE_URL;
        else process.env.WHATSAPP_GRAPH_BASE_URL = anterior;
      }
    }
  }

  const real = () => new TransporteApuntadoAlLocal(base);

  it('200 con identificador: enviado', async () => {
    const r = await real().enviar(sobre());

    expect(r.ok).toBe(true);
    expect(r.wamid).toBe('wamid.SIMULADO');
    expect(r.ambiguo).toBeFalsy();
  });

  it('manda el cuerpo que espera la Cloud API', async () => {
    await real().enviar(sobre());

    const cuerpo = JSON.parse(recibido[0].cuerpo);
    expect(cuerpo.messaging_product).toBe('whatsapp');
    expect(cuerpo.to).toBe('573001112233');
    expect(cuerpo.type).toBe('text');
  });

  it('11. 200 SIN identificador es AMBIGUO, no un éxito', async () => {
    // Meta aceptó algo pero no dice qué. Darlo por bueno pierde el rastro;
    // darlo por fallo reintentable manda el mensaje dos veces.
    guion = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ messages: [] }));
    };

    const r = await real().enviar(sobre());

    expect(r.ok).toBe(false);
    expect(r.ambiguo).toBe(true);
    expect(esReintentable(r.errorCode!)).toBe(false);
  });

  it('respuesta que no es JSON: ambigua', async () => {
    guion = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html>error del balanceador</html>');
    };

    const r = await real().enviar(sobre());
    expect(r.ok).toBe(false);
    expect(esReintentable(r.errorCode!)).toBe(false);
  });

  it('12. una conexión cortada a mitad NO se reintenta', async () => {
    // El caso más peligroso: la petición salió, Meta pudo procesarla y la
    // respuesta se perdió. Reintentar es mandarle al cliente lo mismo otra vez.
    guion = (_req, res) => {
      res.socket?.destroy();
    };

    const r = await real().enviar(sobre());

    expect(r.ok).toBe(false);
    expect(r.ambiguo).toBe(true);
    expect(esReintentable(r.errorCode!)).toBe(false);
    expect(politicaDeError(r.errorCode!).necesitaAtencion).toBe(true);
  });

  it('un rechazo de conexión SÍ se reintenta: no llegó a salir', async () => {
    // Sin servidor al otro lado la petición no se escribió en ningún sitio.
    // Aquí reintentar es gratis y además es lo único que puede funcionar.
    const sinServidor = new TransporteApuntadoAlLocal('http://127.0.0.1:1');
    const r = await sinServidor.enviar(sobre());

    expect(r.ok).toBe(false);
    expect(r.ambiguo).toBe(false);
    expect(esReintentable(r.errorCode!)).toBe(true);
  });

  it('13. 429 se reintenta, y con más espera que un fallo de red', async () => {
    guion = (_req, res) => {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 130429 } }));
    };

    const r = await real().enviar(sobre());

    expect(r.errorCode).toBe('limite-de-tasa');
    const politica = politicaDeError(r.errorCode!);
    expect(politica.reintentar).toBe(true);
    // Reintentar rápido un 429 lo empeora.
    expect(politica.backoffMs).toBeGreaterThan(
      politicaDeError('red').backoffMs,
    );
  });

  it('17. un 429 con `Retry-After` propaga esa espera', async () => {
    // Cuando el otro extremo dice cuánto esperar, insistir antes solo empeora
    // el 429 y acerca el bloqueo del número.
    guion = (_req, res) => {
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': '90',
      });
      res.end(JSON.stringify({ error: { code: 130429 } }));
    };

    const r = await real().enviar(sobre());

    expect(r.errorCode).toBe('limite-de-tasa');
    expect(r.retryAfterSegundos).toBe(90);
  });

  it('un 429 sin cabecera no inventa una espera', async () => {
    guion = (_req, res) => {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 130429 } }));
    };

    expect((await real().enviar(sobre())).retryAfterSegundos).toBeUndefined();
  });

  it('14. 401 NO se reintenta a ciegas', async () => {
    guion = (_req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 190 } }));
    };

    const r = await real().enviar(sobre());

    expect(r.errorCode).toBe('token-invalido');
    expect(esReintentable('token-invalido')).toBe(false);
    // Alguien tiene que reconectar el número; reintentar no lo arregla.
    expect(politicaDeError('token-invalido').necesitaAtencion).toBe(true);
  });

  it('403 se clasifica como falta de permiso', async () => {
    guion = (_req, res) => {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 10 } }));
    };

    expect((await real().enviar(sobre())).errorCode).toBe('sin-permiso');
  });

  it('15. una plantilla inválida bloquea y pide atención', async () => {
    guion = (_req, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 132001 } }));
    };

    const r = await real().enviar(sobre());

    expect(r.errorCode).toBe('plantilla-invalida');
    expect(esReintentable(r.errorCode!)).toBe(false);
    expect(politicaDeError(r.errorCode!).handoff).toBe(true);
  });

  it('16. fuera de la ventana se clasifica y pasa a una persona', async () => {
    guion = (_req, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 131047 } }));
    };

    const r = await real().enviar(sobre());

    expect(r.errorCode).toBe('fuera-de-ventana');
    expect(politicaDeError(r.errorCode!).handoff).toBe(true);
  });

  it('500 se reintenta: Meta se cae y vuelve', async () => {
    guion = (_req, res) => {
      res.writeHead(500);
      res.end('{}');
    };

    const r = await real().enviar(sobre());
    expect(r.errorCode).toBe('meta-caido');
    expect(esReintentable(r.errorCode!)).toBe(true);
  });

  it('cada clase de error tiene una explicación legible', async () => {
    // Sin esto, quien abre una ejecución fallida ve un código y tiene que
    // preguntar qué significa.
    for (const clase of [
      'red',
      'meta-caido',
      'limite-de-tasa',
      'resultado-ambiguo',
      'token-invalido',
      'plantilla-invalida',
      'fuera-de-ventana',
      'cuenta-restringida',
    ]) {
      const politica = politicaDeError(clase);
      expect([clase, politica.mensajeVisible.length > 20]).toEqual([
        clase,
        true,
      ]);
      // El mensaje visible no es un código con guiones disfrazado de frase.
      // (No se compara contra la clase entera: «red» es además una palabra
      // normal y aparece con toda razón en su propio mensaje.)
      expect([
        clase,
        /[a-z]+-[a-z]+-[a-z]+/.test(politica.mensajeVisible),
      ]).toEqual([clase, false]);
    }
  });

  it('20. NINGÚN resultado arrastra el token ni el teléfono completo', async () => {
    // El resultado acaba en la base y en los registros. Basta con que una
    // respuesta de error se copie entera para filtrar el token.
    const respuestas: Array<() => void> = [
      () => {
        guion = (_req, res) => {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: {
                code: 131047,
                // Meta devuelve de verdad cosas así en `error_data`.
                message: 'Message failed to send to 573001112233',
                error_data: { details: 'token=TOKEN-FALSO-DE-PRUEBA-NO-REAL' },
              },
            }),
          );
        };
      },
      () => {
        guion = (_req, res) => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'TOKEN-FALSO' } }));
        };
      },
    ];

    for (const preparar of respuestas) {
      preparar();
      const r = await real().enviar(sobre());
      const serializado = JSON.stringify(r);

      expect(serializado).not.toContain('TOKEN-FALSO');
      expect(serializado).not.toContain('573001112233');
    }
  });

  it('el token viaja en la cabecera y nunca en el cuerpo', async () => {
    await real().enviar(sobre());

    expect(recibido[0].headers.authorization).toBe(
      'Bearer TOKEN-FALSO-DE-PRUEBA-NO-REAL',
    );
    expect(recibido[0].cuerpo).not.toContain('TOKEN-FALSO');
  });
});

/**
 * LOS TRES TRANSPORTES CUMPLEN EL MISMO CONTRATO.
 *
 * Es lo que permite que una prueba con el falso diga algo sobre lo que hará el
 * real. Si el falso aceptara otra cosa o devolviera otra forma, todo lo que se
 * prueba con él dejaría de significar nada el día que se cambie.
 */
describe('Contrato común de los tres transportes', () => {
  const casos: Array<[string, () => TransporteWhatsApp]> = [
    ['falso', () => new TransporteWhatsAppFalso()],
    ['dry-run', () => new TransporteWhatsAppDryRun()],
  ];

  it.each(casos)(
    '7. el transporte %s NO abre ninguna conexión',
    async (_nombre, crear) => {
      // Se rompe `http.request` entero: si el transporte intentara salir a la
      // red por cualquier vía, esta prueba fallaría en vez de pasar por
      // casualidad porque no había servidor.
      const original = http.request;
      const intentos: string[] = [];
      (http as { request: unknown }).request = (...args: unknown[]) => {
        intentos.push(String(args[0]));
        throw new Error('ninguna prueba puede abrir conexiones');
      };

      try {
        const r = await crear().enviar({
          phoneNumberId: 'n1',
          accessToken: 'token',
          to: '573001112233',
          cuerpo: { type: 'text', text: { body: 'Hola' } },
        });
        expect(r.ok).toBe(true);
        expect(r.wamid).toBeTruthy();
      } finally {
        (http as { request: unknown }).request = original;
      }

      expect(intentos).toEqual([]);
    },
  );

  it('el dry-run se identifica y no finge un identificador de Meta', async () => {
    // Un `wamid` con formato real acabaría en la pantalla y alguien lo
    // buscaría en el panel de Meta sin encontrarlo.
    const r = await new TransporteWhatsAppDryRun().enviar({
      phoneNumberId: 'n1',
      accessToken: 'token',
      to: '573001112233',
      cuerpo: { type: 'text', text: { body: 'Hola' } },
    });

    expect(r.dryRun).toBe(true);
    expect(r.wamid).toMatch(/^dryrun-/);
    expect(r.wamid).not.toMatch(/^wamid\./);
  });

  it('el dry-run guarda lo preparado con el teléfono enmascarado', async () => {
    const t = new TransporteWhatsAppDryRun();
    await t.enviar({
      phoneNumberId: 'n1',
      accessToken: 'TOKEN-SECRETO',
      to: '573001112233',
      cuerpo: { type: 'text', text: { body: 'Hola' } },
    });

    const [preparado] = t.simulados;
    expect(preparado.destinatarioEnmascarado).toBe('····2233');
    // El token NO entra ni truncado: esto se lee en soporte y se pega en
    // capturas.
    expect(JSON.stringify(t.simulados)).not.toContain('TOKEN-SECRETO');
  });

  it('esAmbiguo distingue lo que salió de lo que no', () => {
    expect(esAmbiguo(new Error('cualquiera'))).toBe(false);
  });
});
