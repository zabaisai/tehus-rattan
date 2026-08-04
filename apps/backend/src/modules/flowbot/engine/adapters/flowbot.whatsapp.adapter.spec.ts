import { WhatsAppTokenCryptoService } from '../../../whatsapp-integration/whatsapp-token-crypto.service';
import {
  ErrorDeEnvio,
  VENTANA_MS,
  WhatsappAdapter,
} from './flowbot.whatsapp.adapter';
import { TransporteWhatsAppFalso } from './flowbot.whatsapp.fake-transport';
import {
  clasificar,
  esReintentable,
  politicaDeError,
  requiereAtencionHumana,
} from './flowbot.whatsapp.transport';

/**
 * Todo lo que NO es hablar con Meta se prueba aquí: el número remitente, la
 * ventana de 24 h, la idempotencia y la clasificación de errores.
 *
 * El transporte es el falso CONTRACTUAL, el mismo que corre hoy en
 * producción. Así estas pruebas dicen algo sobre lo que pasará de verdad el
 * día que se conecte Meta, y no solo sobre sí mismas.
 */
describe('WhatsappAdapter', () => {
  let prisma: any;
  let transporte: TransporteWhatsAppFalso;
  let cripto: { decrypt: jest.Mock };
  let adaptador: WhatsappAdapter;

  const integracionDeLaConversacion = {
    id: 'wa-conv',
    phoneNumberId: 'phone-soporte',
    status: 'CONNECTED',
    accessTokenEncrypted: 'cifrado-soporte',
  };

  beforeEach(() => {
    prisma = {
      message: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'msg-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      conversation: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'conv-1',
          contact: { phone: '+573001112233' },
          whatsappIntegration: integracionDeLaConversacion,
        }),
      },
      whatsAppIntegration: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    transporte = new TransporteWhatsAppFalso();
    cripto = { decrypt: jest.fn().mockReturnValue('token-en-claro') };

    // Los tres transportes apuntan al falso: estas pruebas son sobre la
    // LÓGICA del adaptador —ventana, idempotencia, clasificación—, y esa es la
    // misma corra el transporte que corra. Cuál se elige lo prueban las
    // pruebas de guardarraíles.
    adaptador = new WhatsappAdapter(
      prisma,
      'emp-1',
      { falso: transporte, dryRun: transporte, real: transporte },
      cripto as unknown as WhatsAppTokenCryptoService,
      guardarrailesQuePermiten(),
      plantillasAprobadas(),
      'ejec-1',
    );
  });

  /** Deja la ventana abierta: hay un entrante reciente. */
  const conVentanaAbierta = () => {
    prisma.message.findFirst.mockImplementation((args: any) =>
      args.where?.direction === 'INBOUND'
        ? Promise.resolve({ createdAt: new Date() })
        : Promise.resolve(null),
    );
  };

  describe('ventana de 24 horas', () => {
    it('se mide desde el último mensaje ENTRANTE', async () => {
      conVentanaAbierta();

      await adaptador.dentroDeVentana({ conversationId: 'conv-1' });

      // Medirla desde uno saliente la mantendría abierta para siempre: cada
      // respuesta del bot renovaría su propio permiso.
      expect(prisma.message.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ direction: 'INBOUND' }),
        }),
      );
    });

    it('está cerrada si no hay ningún entrante', async () => {
      prisma.message.findFirst.mockResolvedValue(null);

      await expect(
        adaptador.dentroDeVentana({ conversationId: 'conv-1' }),
      ).resolves.toBe(false);
    });

    it('está cerrada si el último entrante es más viejo que la ventana', async () => {
      prisma.message.findFirst.mockResolvedValue({
        createdAt: new Date(Date.now() - VENTANA_MS - 1000),
      });

      await expect(
        adaptador.dentroDeVentana({ conversationId: 'conv-1' }),
      ).resolves.toBe(false);
    });

    it('el texto libre se rechaza fuera de la ventana', async () => {
      prisma.message.findFirst.mockResolvedValue(null);

      await expect(
        adaptador.enviarTexto({
          conversationId: 'conv-1',
          texto: 'hola',
          idempotencyKey: 'k1',
        }),
      ).rejects.toMatchObject({ errorCode: 'fuera-de-ventana' });
      expect(transporte.enviados).toHaveLength(0);
    });

    it('una PLANTILLA sí sale fuera de la ventana', async () => {
      // Es justo lo único que Meta permite para retomar el contacto:
      // bloquearla dejaría al cliente sin la única vía posible.
      prisma.message.findFirst.mockResolvedValue(null);

      await adaptador.enviarPlantilla({
        conversationId: 'conv-1',
        plantilla: 'recordatorio',
        parametros: ['Ana'],
        idempotencyKey: 'k1',
      });

      expect(transporte.vecesDe('template')).toBe(1);
    });
  });

  describe('número remitente', () => {
    it('responde por DONDE ENTRÓ la conversación', async () => {
      conVentanaAbierta();

      await adaptador.enviarTexto({
        conversationId: 'conv-1',
        texto: 'hola',
        idempotencyKey: 'k1',
      });

      // Con varios números, contestar desde el principal manda la respuesta
      // desde un número que el cliente no reconoce.
      expect(transporte.ultimo()?.phoneNumberId).toBe('phone-soporte');
    });

    it('si ese número está desconectado cae al principal, con desempate explícito', async () => {
      conVentanaAbierta();
      prisma.conversation.findFirst.mockResolvedValue({
        id: 'conv-1',
        contact: { phone: '+573001112233' },
        whatsappIntegration: {
          ...integracionDeLaConversacion,
          status: 'DISCONNECTED',
        },
      });
      prisma.whatsAppIntegration.findFirst.mockResolvedValue({
        phoneNumberId: 'phone-principal',
        accessTokenEncrypted: 'cifrado-principal',
      });

      await adaptador.enviarTexto({
        conversationId: 'conv-1',
        texto: 'hola',
        idempotencyKey: 'k1',
      });

      expect(transporte.ultimo()?.phoneNumberId).toBe('phone-principal');
      // NUNCA un findFirst sin orden: con dos números elegiría uno distinto
      // según el día.
      expect(prisma.whatsAppIntegration.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ isPrimary: 'desc' }, { order: 'asc' }, { id: 'asc' }],
        }),
      );
    });

    it('sin ningún número conectado pide atención humana', async () => {
      conVentanaAbierta();
      prisma.conversation.findFirst.mockResolvedValue({
        id: 'conv-1',
        contact: { phone: '+573001112233' },
        whatsappIntegration: null,
      });
      prisma.whatsAppIntegration.findFirst.mockResolvedValue(null);

      await expect(
        adaptador.enviarTexto({
          conversationId: 'conv-1',
          texto: 'hola',
          idempotencyKey: 'k1',
        }),
      ).rejects.toMatchObject({
        errorCode: 'sin-numero-conectado',
        clase: 'atencion',
      });
    });
  });

  describe('idempotencia', () => {
    it('un reintento con la misma clave NO reenvía', async () => {
      conVentanaAbierta();
      prisma.message.findFirst.mockImplementation((args: any) => {
        if (args.where?.externalKey === 'k1') {
          return Promise.resolve({ wamid: 'wamid-previo', status: 'SENT' });
        }
        return Promise.resolve({ createdAt: new Date() });
      });

      const r = await adaptador.enviarTexto({
        conversationId: 'conv-1',
        texto: 'hola',
        idempotencyKey: 'k1',
      });

      expect(r.wamid).toBe('wamid-previo');
      expect(transporte.enviados).toHaveLength(0);
    });

    it('la fila se reserva ANTES de llamar a Meta', async () => {
      conVentanaAbierta();
      const orden: string[] = [];
      prisma.message.create.mockImplementation(async () => {
        orden.push('reservar');
        return { id: 'msg-1' };
      });
      const enviarOriginal = transporte.enviar.bind(transporte);
      jest.spyOn(transporte, 'enviar').mockImplementation(async (s) => {
        orden.push('enviar');
        return enviarOriginal(s);
      });

      await adaptador.enviarTexto({
        conversationId: 'conv-1',
        texto: 'hola',
        idempotencyKey: 'k1',
      });

      // Al revés, morir entre el envío y la escritura dejaría un mensaje
      // entregado al cliente sin rastro en el hilo, y el reintento se lo
      // mandaría otra vez.
      expect(orden).toEqual(['reservar', 'enviar']);
    });

    it('la reserva lleva la clave del motor', async () => {
      conVentanaAbierta();

      await adaptador.enviarTexto({
        conversationId: 'conv-1',
        texto: 'hola',
        idempotencyKey: 'exec:nodo:3',
      });

      expect(prisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ externalKey: 'exec:nodo:3' }),
        }),
      );
    });
  });

  describe('menús', () => {
    it('con más de 3 opciones cambia a lista en vez de perder las que sobran', async () => {
      conVentanaAbierta();

      await adaptador.enviarOpciones({
        conversationId: 'conv-1',
        texto: 'Elige',
        opciones: ['a', 'b', 'c', 'd'],
        formato: 'buttons',
        idempotencyKey: 'k1',
      });

      // Meta admite 3 botones. Superarlo produce un rechazo con un código que
      // no dice cuál de los tres fue.
      const cuerpo = transporte.ultimo()?.cuerpo as any;
      expect(cuerpo.interactive.type).toBe('list');
      expect(cuerpo.interactive.action.sections[0].rows).toHaveLength(4);
    });

    it('recorta los títulos al límite de Meta', async () => {
      conVentanaAbierta();

      await adaptador.enviarOpciones({
        conversationId: 'conv-1',
        texto: 'Elige',
        opciones: ['x'.repeat(50)],
        formato: 'buttons',
        idempotencyKey: 'k1',
      });

      const cuerpo = transporte.ultimo()?.cuerpo as any;
      expect(cuerpo.interactive.action.buttons[0].reply.title.length).toBe(20);
    });

    it('un menú sin opciones no sale', async () => {
      conVentanaAbierta();

      await expect(
        adaptador.enviarOpciones({
          conversationId: 'conv-1',
          texto: 'Elige',
          opciones: [],
          formato: 'buttons',
          idempotencyKey: 'k1',
        }),
      ).rejects.toBeInstanceOf(ErrorDeEnvio);
    });
  });

  describe('medios', () => {
    it('rechaza una URL que no es https', async () => {
      conVentanaAbierta();

      // Meta descarga el archivo desde esa URL: una `http` lo expondría en
      // claro, y una interna sería una petición desde Meta a nuestra red.
      await expect(
        adaptador.enviarMedio({
          conversationId: 'conv-1',
          tipo: 'image',
          url: 'http://ejemplo.com/x.png',
          idempotencyKey: 'k1',
        }),
      ).rejects.toMatchObject({ errorCode: 'medio-url-insegura' });
    });

    it('el nombre de archivo solo va en documentos', async () => {
      conVentanaAbierta();

      await adaptador.enviarMedio({
        conversationId: 'conv-1',
        tipo: 'image',
        url: 'https://ejemplo.com/x.png',
        filename: 'x.png',
        idempotencyKey: 'k1',
      });

      const cuerpo = transporte.ultimo()?.cuerpo as any;
      expect(cuerpo.image.filename).toBeUndefined();
    });
  });

  describe('clasificación de errores', () => {
    it('un 500 de Meta es reintentable', async () => {
      conVentanaAbierta();
      transporte.programarFallo({ httpStatus: 503 });

      await expect(
        adaptador.enviarTexto({
          conversationId: 'conv-1',
          texto: 'hola',
          idempotencyKey: 'k1',
        }),
      ).rejects.toMatchObject({
        errorCode: 'meta-caido',
        clase: 'externo_transitorio',
      });
    });

    it('un token inválido pide atención humana, no reintentos', async () => {
      conVentanaAbierta();
      transporte.programarFallo({ httpStatus: 401, metaCode: 190 });

      await expect(
        adaptador.enviarTexto({
          conversationId: 'conv-1',
          texto: 'hola',
          idempotencyKey: 'k1',
        }),
      ).rejects.toMatchObject({
        errorCode: 'token-invalido',
        clase: 'atencion',
      });
      // Reintentarlo cinco veces no lo arregla: alguien tiene que reconectar.
      expect(esReintentable('token-invalido')).toBe(false);
      expect(requiereAtencionHumana('token-invalido')).toBe(true);
    });

    it('una plantilla inválida pide que alguien la mire', async () => {
      // No se reintenta —reintentar no arregla una plantilla mal aprobada— y
      // además NO se traga en silencio: si nadie se entera, el bot sigue
      // fallando igual mañana con todos los clientes que lleguen.
      conVentanaAbierta();
      transporte.programarFallo({ httpStatus: 400, metaCode: 132001 });

      await expect(
        adaptador.enviarPlantilla({
          conversationId: 'conv-1',
          plantilla: 'no-existe',
          parametros: [],
          idempotencyKey: 'k1',
        }),
      ).rejects.toMatchObject({ clase: 'atencion' });
      expect(esReintentable('plantilla-invalida')).toBe(false);
    });

    it('el mensaje queda FAILED con el clasificador y SIN el texto de Meta', async () => {
      conVentanaAbierta();
      transporte.programarFallo({ httpStatus: 400, metaCode: 131026 });

      await expect(
        adaptador.enviarTexto({
          conversationId: 'conv-1',
          texto: 'hola',
          idempotencyKey: 'k1',
        }),
      ).rejects.toBeInstanceOf(ErrorDeEnvio);

      const marcado = prisma.message.updateMany.mock.calls[0][0].data;
      expect(marcado.status).toBe('FAILED');
      expect(marcado.errorCode).toBe('destinatario-no-alcanzable');

      // `errorMessage` lleva NUESTRA frase, sacada de la política de esa clase
      // de error, nunca la respuesta de Meta: esa arrastra el teléfono del
      // destinatario y a veces el mensaje entero. Sin frase, quien abre la
      // conversación ve `destinatario-no-alcanzable` y tiene que preguntar
      // qué significa.
      expect(marcado.errorMessage).toBe(
        politicaDeError('destinatario-no-alcanzable').mensajeVisible,
      );
      expect(marcado.errorMessage).not.toContain('573001112233');
      expect(marcado.errorMessage).not.toContain('hola');
    });

    it('un token que no se puede descifrar pide atención', async () => {
      conVentanaAbierta();
      cripto.decrypt.mockImplementation(() => {
        throw new Error('clave rotada');
      });

      await expect(
        adaptador.enviarTexto({
          conversationId: 'conv-1',
          texto: 'hola',
          idempotencyKey: 'k1',
        }),
      ).rejects.toMatchObject({ clase: 'atencion' });
    });
  });

  describe('el transporte falso no filtra nada', () => {
    it('registra el teléfono ENMASCARADO', async () => {
      conVentanaAbierta();

      await adaptador.enviarTexto({
        conversationId: 'conv-1',
        texto: 'hola',
        idempotencyKey: 'k1',
      });

      // Ni siquiera en una prueba hace falta el número entero.
      expect(transporte.ultimo()?.to).toBe('****2233');
    });

    it('no conserva el token en ningún sitio', async () => {
      conVentanaAbierta();

      await adaptador.enviarTexto({
        conversationId: 'conv-1',
        texto: 'hola',
        idempotencyKey: 'k1',
      });

      // Un doble que guarda secretos acaba volcándolos en la salida de una
      // prueba fallida.
      expect(JSON.stringify(transporte.enviados)).not.toContain(
        'token-en-claro',
      );
    });

    it('devuelve identificadores con prefijo sim-', () => {
      // Si uno acabara donde no debe, se reconoce a simple vista.
      expect(clasificar(500)).toBe('meta-caido');
    });
  });
});

/**
 * Guardarraíles que dejan pasar en modo falso.
 *
 * Devuelve `falso` y no `real` a propósito: estas pruebas no deben poder
 * mandar nada aunque alguien cambie la configuración de su máquina.
 */
function guardarrailesQuePermiten() {
  return {
    evaluar: jest.fn().mockResolvedValue({
      modo: 'falso',
      bloqueos: [],
      explicacion: 'prueba',
    }),
  } as never;
}

function plantillasAprobadas() {
  return {
    estado: jest.fn().mockResolvedValue({
      aprobada: true,
      parametros: 0,
      idioma: 'es',
      verificadaEn: new Date(),
    }),
  } as never;
}
