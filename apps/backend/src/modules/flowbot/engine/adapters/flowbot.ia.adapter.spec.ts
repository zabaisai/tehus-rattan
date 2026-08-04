import { WhatsAppTokenCryptoService } from '../../../whatsapp-integration/whatsapp-token-crypto.service';
import { IaAdapter } from './flowbot.ia.adapter';
import { ProveedorIaFalso } from './flowbot.ia.fake-provider';
import { RegistroProveedoresIa, redactarPii } from './flowbot.ia.provider';

/**
 * Lo que se prueba aquí NO es el modelo: es todo lo que lo envuelve, que es
 * donde están las decisiones que importan. La redacción de PII, los topes de
 * gasto, el prompt del sistema y la validación de la salida se ejercitan
 * exactamente igual con el proveedor falso que con uno real, porque implementan
 * el mismo contrato.
 */
describe('IaAdapter', () => {
  let prisma: any;
  let registro: RegistroProveedoresIa;
  let proveedor: ProveedorIaFalso;
  let adaptador: IaAdapter;

  const configurada = {
    aiEnabled: true,
    aiProvider: 'simulado',
    aiModel: 'modelo-x',
    aiApiKeyEncrypted: 'cifrada',
    aiMaxTokensPerCall: 500,
    aiMaxCallsPerDay: 500,
    aiTimeoutMs: 15_000,
    aiRedactPii: true,
    aiSystemPrompt: 'Eres el asistente de TAKTO. No prometas descuentos.',
  };

  beforeEach(() => {
    prisma = {
      flowBotSettings: { findUnique: jest.fn().mockResolvedValue(configurada) },
      flowBotAiUsage: {
        findUnique: jest.fn().mockResolvedValue({ calls: 0 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    registro = new RegistroProveedoresIa();
    proveedor = new ProveedorIaFalso();
    registro.registrar(proveedor);

    adaptador = new IaAdapter(prisma, 'emp-1', registro, {
      decrypt: () => 'clave-en-claro',
    } as unknown as WhatsAppTokenCryptoService);
  });

  describe('disponibilidad', () => {
    it('está disponible con todo configurado', async () => {
      await expect(adaptador.disponible()).resolves.toBe(true);
    });

    it('NO está disponible si la empresa no la encendió', async () => {
      prisma.flowBotSettings.findUnique.mockResolvedValue({
        ...configurada,
        aiEnabled: false,
      });
      await expect(adaptador.disponible()).resolves.toBe(false);
    });

    it('NO está disponible si el proveedor no está registrado', async () => {
      // Es el caso de hoy con un proveedor real: la configuración lo nombra
      // pero nadie lo implementó. Decirlo es mejor que fingir que existe.
      prisma.flowBotSettings.findUnique.mockResolvedValue({
        ...configurada,
        aiProvider: 'openai',
      });
      await expect(adaptador.disponible()).resolves.toBe(false);
    });

    it('NO está disponible sin credencial guardada', async () => {
      prisma.flowBotSettings.findUnique.mockResolvedValue({
        ...configurada,
        aiApiKeyEncrypted: null,
      });
      await expect(adaptador.disponible()).resolves.toBe(false);
    });

    it('NO está disponible con la cuota del día agotada', async () => {
      // Los nodos preguntan esto ANTES de llamar, así que un tope alcanzado
      // saca el flujo por su rama de reserva en vez de ser un error.
      prisma.flowBotAiUsage.findUnique.mockResolvedValue({ calls: 500 });
      await expect(adaptador.disponible()).resolves.toBe(false);
    });

    it('sin configuración ninguna, tampoco', async () => {
      prisma.flowBotSettings.findUnique.mockResolvedValue(null);
      await expect(adaptador.disponible()).resolves.toBe(false);
    });
  });

  describe('redacción de PII', () => {
    it('el teléfono del cliente NO sale del CRM', async () => {
      // Lo que sale no vuelve: un proveedor guarda las peticiones para
      // depuración y a veces las usa para entrenar.
      await adaptador.clasificar({
        companyId: 'emp-1',
        texto: 'Mi número es +573001112233, llámame',
        opciones: ['llamar', 'escribir'],
      });

      const enviado = proveedor.peticiones[0].usuario;
      expect(enviado).not.toContain('573001112233');
      expect(enviado).toContain('[TELEFONO]');
    });

    it('el correo tampoco', async () => {
      await adaptador.clasificar({
        companyId: 'emp-1',
        texto: 'escríbeme a ana.perez@ejemplo.com',
        opciones: ['a', 'b'],
      });
      const enviado = proveedor.peticiones[0].usuario;
      expect(enviado).not.toContain('ana.perez@ejemplo.com');
      expect(enviado).toContain('[CORREO]');
    });

    it('el marcador se deja para que la frase siga entendiéndose', () => {
      // «Mi cédula es» a secas parece una frase cortada; con el marcador el
      // modelo sabe que había un dato ahí.
      expect(redactarPii('Mi cedula es 12345678')).toBe(
        'Mi cedula es [DOCUMENTO]',
      );
    });

    it('un número ambiguo se marca como teléfono, pero SE MARCA', () => {
      // Diez dígitos en Colombia pueden ser un móvil o una cédula, y no hay
      // forma de saberlo sin contexto. Etiquetarlo mal es un problema de
      // legibilidad; dejarlo pasar sería una fuga.
      const r = redactarPii('el numero es 1020304050');
      expect(r).not.toContain('1020304050');
      expect(r).toMatch(/\[(TELEFONO|DOCUMENTO)\]/);
    });

    it('se puede desactivar explícitamente', async () => {
      prisma.flowBotSettings.findUnique.mockResolvedValue({
        ...configurada,
        aiRedactPii: false,
      });
      await adaptador.clasificar({
        companyId: 'emp-1',
        texto: '+573001112233',
        opciones: ['a', 'b'],
      });
      expect(proveedor.peticiones[0].usuario).toContain('573001112233');
    });

    it('el texto se recorta antes de salir', async () => {
      await adaptador.clasificar({
        companyId: 'emp-1',
        texto: 'x'.repeat(10_000),
        opciones: ['a', 'b'],
      });
      expect(proveedor.peticiones[0].usuario.length).toBe(4000);
    });
  });

  describe('prompt del sistema', () => {
    it('es el de la EMPRESA, no el del nodo', async () => {
      await adaptador.extraer({
        companyId: 'emp-1',
        texto: 'hola',
        campos: ['nombre'],
      });

      // El autor de un flujo no puede reescribir las reglas de la empresa
      // desde el texto de un nodo: las suyas van debajo, no encima.
      const sistema = proveedor.peticiones[0].sistema;
      expect(sistema.startsWith(configurada.aiSystemPrompt)).toBe(true);
      expect(sistema).toContain('nombre');
    });
  });

  describe('clasificación', () => {
    it('devuelve una opción de la lista', async () => {
      const r = await adaptador.clasificar({
        companyId: 'emp-1',
        texto: 'quiero comprar',
        opciones: ['ventas', 'soporte'],
      });
      expect(['ventas', 'soporte']).toContain(r.eleccion);
      expect(r.confianza).toBeGreaterThan(0);
    });

    it('es determinista: el mismo texto da la misma rama', async () => {
      // Con azar real, un reintento mandaría al cliente por el otro camino.
      const a = await adaptador.clasificar({
        companyId: 'emp-1',
        texto: 'quiero comprar',
        opciones: ['ventas', 'soporte'],
      });
      const b = await adaptador.clasificar({
        companyId: 'emp-1',
        texto: 'quiero comprar',
        opciones: ['ventas', 'soporte'],
      });
      expect(a.eleccion).toBe(b.eleccion);
    });

    it('DESCARTA una elección que no está en la lista', async () => {
      // Aceptar «casi» la opción correcta es como se acaba mandando al cliente
      // por la rama equivocada. La salida de un modelo es entrada no confiable.
      proveedor.forzar({ eleccion: 'inventada' });

      const r = await adaptador.clasificar({
        companyId: 'emp-1',
        texto: 'x',
        opciones: ['ventas', 'soporte'],
      });
      expect(r).toEqual({ eleccion: null, confianza: 0 });
    });

    it('un fallo del proveedor sale con confianza cero, no revienta', async () => {
      proveedor.forzarFallo();

      const r = await adaptador.clasificar({
        companyId: 'emp-1',
        texto: 'x',
        opciones: ['a', 'b'],
      });
      expect(r).toEqual({ eleccion: null, confianza: 0 });
    });
  });

  describe('extracción estructurada', () => {
    it('solo devuelve los campos declarados', async () => {
      proveedor.forzar({
        texto: JSON.stringify({ nombre: 'Ana', inventado: 'x' }),
      });

      const r = await adaptador.extraer({
        companyId: 'emp-1',
        texto: 'me llamo Ana',
        campos: ['nombre'],
      });
      // Un modelo que se inventa un campo llenaría el CRM de datos que nadie
      // pidió.
      expect(r).toEqual({ nombre: 'Ana' });
    });

    it('descarta un valor que es un objeto', async () => {
      // `String({})` daría "[object Object]" y guardaríamos basura creyendo
      // que es un dato.
      proveedor.forzar({ texto: JSON.stringify({ nombre: { a: 1 } }) });

      const r = await adaptador.extraer({
        companyId: 'emp-1',
        texto: 'x',
        campos: ['nombre'],
      });
      expect(r).toEqual({});
    });

    it('una respuesta que no es JSON no rompe el flujo', async () => {
      proveedor.forzar({ texto: 'pues no sé' });

      await expect(
        adaptador.extraer({
          companyId: 'emp-1',
          texto: 'x',
          campos: ['nombre'],
        }),
      ).resolves.toEqual({});
    });
  });

  describe('topes de gasto', () => {
    it('el consumo se anota SIEMPRE, salga bien o mal', async () => {
      // Una llamada que falla después de gastar tokens los gastó igual. No
      // contarla haría que el tope se saltara solo provocando errores.
      proveedor.forzarFallo();
      await adaptador.clasificar({
        companyId: 'emp-1',
        texto: 'x',
        opciones: ['a'],
      });

      expect(prisma.flowBotAiUsage.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ calls: { increment: 1 } }),
        }),
      );
    });

    it('con la cuota agotada NO llega al proveedor', async () => {
      prisma.flowBotAiUsage.findUnique.mockResolvedValue({ calls: 999 });

      await expect(
        adaptador.redactar({
          companyId: 'emp-1',
          instrucciones: 'resume',
          texto: 'x',
        }),
      ).rejects.toMatchObject({ errorCode: 'ia-cuota-agotada' });
      expect(proveedor.peticiones).toHaveLength(0);
    });

    it('el tope de tokens del nodo no puede superar el de la empresa', async () => {
      await adaptador.extraer({
        companyId: 'emp-1',
        texto: 'x',
        campos: ['a'],
      });
      expect(proveedor.peticiones[0].maxTokens).toBeLessThanOrEqual(500);
    });
  });

  describe('errores clasificados', () => {
    it('sin configurar es un fallo de CONFIGURACIÓN, no de red', async () => {
      // Reintentarlo cinco veces no lo va a configurar.
      prisma.flowBotSettings.findUnique.mockResolvedValue(null);

      await expect(
        adaptador.redactar({
          companyId: 'emp-1',
          instrucciones: 'x',
          texto: 'y',
        }),
      ).rejects.toMatchObject({
        errorCode: 'ia-no-configurada',
        clase: 'configuracion',
      });
    });

    it('una credencial ilegible también', async () => {
      const roto = new IaAdapter(prisma, 'emp-1', registro, {
        decrypt: () => {
          throw new Error('clave rotada');
        },
      } as unknown as WhatsAppTokenCryptoService);

      await expect(
        roto.redactar({ companyId: 'emp-1', instrucciones: 'x', texto: 'y' }),
      ).rejects.toMatchObject({ clase: 'configuracion' });
    });
  });

  describe('el proveedor falso no filtra nada', () => {
    it('no conserva la clave en las peticiones registradas', async () => {
      await adaptador.clasificar({
        companyId: 'emp-1',
        texto: 'x',
        opciones: ['a'],
      });
      expect(JSON.stringify(proveedor.peticiones)).not.toContain(
        'clave-en-claro',
      );
    });
  });
});
