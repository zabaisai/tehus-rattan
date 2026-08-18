import { ModoDemoService, ModoDemoError } from './modo-demo.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * EL MODO DEMO SE CIERRA, NO SE ABRE.
 *
 * La empresa de demostracion existe para que alguien la recorra sin riesgo.
 * Eso significa que un envio real de WhatsApp, una conexion con Meta, un
 * correo o la ejecucion de un bot no pueden ocurrir desde ella NI AUNQUE las
 * banderas globales esten mal puestas: la comprobacion no consulta el entorno,
 * consulta la EMPRESA.
 *
 * FAIL-CLOSED. Si no se puede saber si es demo —base caida, consulta rota— se
 * responde que SI lo es y se bloquea. Un guardarrail que se abre solo cuando
 * no puede comprobarse no es un guardarrail.
 */
describe('ModoDemoService', () => {
  const empresaDemo = { id: 'demo-1', isDemo: true };
  const empresaNormal = { id: 'real-1', isDemo: false };

  function servicio(findUnique: jest.Mock) {
    return new ModoDemoService({
      company: { findUnique },
    } as unknown as PrismaService);
  }

  it('reconoce una empresa demo', async () => {
    const s = servicio(jest.fn().mockResolvedValue(empresaDemo));
    await expect(s.esDemo('demo-1')).resolves.toBe(true);
  });

  it('reconoce una empresa normal', async () => {
    const s = servicio(jest.fn().mockResolvedValue(empresaNormal));
    await expect(s.esDemo('real-1')).resolves.toBe(false);
  });

  it('una empresa que no existe se trata como demo: fail-closed', async () => {
    const s = servicio(jest.fn().mockResolvedValue(null));
    await expect(s.esDemo('fantasma')).resolves.toBe(true);
  });

  it('si la consulta falla se BLOQUEA, no se deja pasar', async () => {
    const s = servicio(jest.fn().mockRejectedValue(new Error('base caida')));
    await expect(s.esDemo('demo-1')).resolves.toBe(true);
  });

  it('NO consulta el entorno: da igual como esten las banderas globales', async () => {
    // Es la garantia que pide el incremento: aunque alguien ponga
    // FLOWBOT_REAL_WHATSAPP_ENABLED=true por error, la empresa demo sigue
    // bloqueada porque el bloqueo no depende de esa variable.
    const anterior = process.env.FLOWBOT_REAL_WHATSAPP_ENABLED;
    process.env.FLOWBOT_REAL_WHATSAPP_ENABLED = 'true';
    process.env.FLOWBOT_WHATSAPP_DRY_RUN = 'false';

    const s = servicio(jest.fn().mockResolvedValue(empresaDemo));
    await expect(
      s.bloquearSiDemo('demo-1', 'enviar un WhatsApp'),
    ).rejects.toThrow(ModoDemoError);

    if (anterior === undefined)
      delete process.env.FLOWBOT_REAL_WHATSAPP_ENABLED;
    else process.env.FLOWBOT_REAL_WHATSAPP_ENABLED = anterior;
    delete process.env.FLOWBOT_WHATSAPP_DRY_RUN;
  });

  describe('bloquearSiDemo', () => {
    it('deja pasar a una empresa normal', async () => {
      const s = servicio(jest.fn().mockResolvedValue(empresaNormal));
      await expect(
        s.bloquearSiDemo('real-1', 'enviar un WhatsApp'),
      ).resolves.toBeUndefined();
    });

    it('bloquea a la demo con un 403 explicable, no con un error ambiguo', async () => {
      const s = servicio(jest.fn().mockResolvedValue(empresaDemo));

      await expect(
        s.bloquearSiDemo('demo-1', 'enviar un WhatsApp'),
      ).rejects.toMatchObject({ status: 403 });

      try {
        await s.bloquearSiDemo('demo-1', 'enviar un WhatsApp');
        fail('deberia haber lanzado');
      } catch (e) {
        const cuerpo = (e as ModoDemoError).getResponse() as {
          code: string;
          message: string;
          accion: string;
        };
        // La interfaz distingue este caso por el codigo, no por el texto.
        expect(cuerpo.code).toBe('MODO_DEMO');
        expect(cuerpo.accion).toBe('enviar un WhatsApp');
        expect(cuerpo.message).toMatch(/demo/i);
      }
    });

    it('el mensaje dice QUE no se puede hacer, para poder explicarlo en pantalla', async () => {
      const s = servicio(jest.fn().mockResolvedValue(empresaDemo));
      await expect(
        s.bloquearSiDemo('demo-1', 'conectar WhatsApp con Meta'),
      ).rejects.toThrow(/conectar WhatsApp con Meta/);
    });
  });
});
