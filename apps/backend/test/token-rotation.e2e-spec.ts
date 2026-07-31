import { PrismaService } from '../src/prisma/prisma.service';
import { WhatsAppTokenCryptoService } from '../src/modules/whatsapp-integration/whatsapp-token-crypto.service';
import { TokenRotationService } from '../src/modules/whatsapp-integration/token-rotation.service';

const CLAVE_VIEJA = 'clave-anterior-solo-para-pruebas-1234567890';
const CLAVE_NUEVA = 'clave-nueva-solo-para-pruebas-0987654321';

/** ConfigService falso con claves controladas por la prueba. */
const configCon = (actual: string, anterior?: string) => ({
  get: (k: string) =>
    k === 'WHATSAPP_TOKEN_ENCRYPTION_KEY'
      ? actual
      : k === 'WHATSAPP_TOKEN_ENCRYPTION_KEY_PREVIOUS'
        ? anterior
        : undefined,
});

/**
 * Rotacion de la clave de cifrado, contra base REAL.
 *
 * Lo que se demuestra aqui es lo unico que importa de una rotacion: que en
 * NINGUN momento del proceso queda un token ilegible. Con dobles, la prueba
 * comprobaria que llamo a los metodos que yo mismo escribi; aqui se cifra, se
 * guarda, se rota y se vuelve a leer de verdad.
 */
describe('Rotacion de la clave de cifrado (e2e, base real)', () => {
  let prisma: PrismaService;
  let empresaId: string;
  const TOKEN = 'EAAG-token-de-prueba-no-real-123456';

  /** Servicios con la clave VIEJA como unica clave: el estado de partida. */
  const conClaveVieja = () => {
    const crypto = new WhatsAppTokenCryptoService(configCon(CLAVE_VIEJA) as never);
    return { crypto, rotacion: new TokenRotationService(prisma, crypto) };
  };

  /** Durante la rotacion: nueva como actual, vieja como anterior. */
  const enRotacion = () => {
    const crypto = new WhatsAppTokenCryptoService(
      configCon(CLAVE_NUEVA, CLAVE_VIEJA) as never,
    );
    return { crypto, rotacion: new TokenRotationService(prisma, crypto) };
  };

  /** Despues de retirar la clave anterior. */
  const soloClaveNueva = () => {
    const crypto = new WhatsAppTokenCryptoService(configCon(CLAVE_NUEVA) as never);
    return { crypto, rotacion: new TokenRotationService(prisma, crypto) };
  };

  const crearIntegracion = async (cifrado: string) => {
    const i = await prisma.whatsAppIntegration.create({
      data: {
        companyId: empresaId,
        phoneNumberId: `pn-${Math.random().toString().slice(2, 10)}`,
        wabaId: 'waba-prueba',
        accessTokenEncrypted: cifrado,
        status: 'CONNECTED',
      },
    });
    return i.id;
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const empresa = await prisma.company.create({
      data: { name: 'E2E Rotacion Co' },
    });
    empresaId = empresa.id;
  });

  afterAll(async () => {
    await prisma.whatsAppIntegration.deleteMany({ where: { companyId: empresaId } });
    await prisma.company.delete({ where: { id: empresaId } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.whatsAppIntegration.deleteMany({ where: { companyId: empresaId } });
  });

  describe('el problema que resuelve', () => {
    it('sin clave anterior, cambiar la clave deja el token ILEGIBLE', () => {
      // Es el fallo que hace falta entender: el sintoma seria "WhatsApp dejo
      // de enviar", sin ninguna pista que apunte a la clave.
      const viejo = conClaveVieja().crypto.encrypt(TOKEN);

      expect(() => soloClaveNueva().crypto.decrypt(viejo)).toThrow();
    });

    it('con la clave anterior configurada, se sigue leyendo', () => {
      const viejo = conClaveVieja().crypto.encrypt(TOKEN);

      const { token, conClaveAnterior } =
        enRotacion().crypto.decryptWithInfo(viejo);

      expect(token).toBe(TOKEN);
      expect(conClaveAnterior).toBe(true);
    });

    it('lo cifrado con la NUEVA no necesita la anterior', () => {
      const nuevo = enRotacion().crypto.encrypt(TOKEN);

      const { token, conClaveAnterior } =
        enRotacion().crypto.decryptWithInfo(nuevo);

      expect(token).toBe(TOKEN);
      expect(conClaveAnterior).toBe(false);
    });

    it('cifrar usa SIEMPRE la clave actual, nunca la anterior', () => {
      // Si cifrara con la anterior, la rotacion no avanzaria nunca.
      const nuevo = enRotacion().crypto.encrypt(TOKEN);

      expect(soloClaveNueva().crypto.decrypt(nuevo)).toBe(TOKEN);
    });
  });

  describe('estado antes de migrar', () => {
    it('cuenta cuantas usan cada clave', async () => {
      // El recuento es GLOBAL a proposito: rotar la clave es una operacion de
      // plataforma, no de una empresa. Por eso la prueba mide el DELTA en vez
      // de asumir una base vacia, que es lo que asumia y fallaba.
      const base = await enRotacion().rotacion.estado();

      await crearIntegracion(conClaveVieja().crypto.encrypt(TOKEN));
      await crearIntegracion(enRotacion().crypto.encrypt(TOKEN));

      const estado = await enRotacion().rotacion.estado();

      expect(estado.total - base.total).toBe(2);
      expect(estado.conClaveAnterior - base.conClaveAnterior).toBe(1);
      expect(estado.conClaveActual - base.conClaveActual).toBe(1);
      expect(estado.rotacionEnCurso).toBe(true);
    });

    it('detecta las ilegibles sin lanzar', async () => {
      const base = await enRotacion().rotacion.estado();

      await crearIntegracion('basura:no:descifrable');

      const estado = await enRotacion().rotacion.estado();

      expect(estado.ilegibles - base.ilegibles).toBe(1);
    });
  });

  describe('recifrado', () => {
    it('migra las de la clave vieja y deja legible el token', async () => {
      const id = await crearIntegracion(conClaveVieja().crypto.encrypt(TOKEN));

      const r = await enRotacion().rotacion.recifrar();

      expect(r.recifradas).toBe(1);
      const fila = await prisma.whatsAppIntegration.findUniqueOrThrow({
        where: { id },
      });
      // Legible SOLO con la nueva: la migracion de verdad ocurrio.
      expect(soloClaveNueva().crypto.decrypt(fila.accessTokenEncrypted!)).toBe(
        TOKEN,
      );
    });

    it('es idempotente: ejecutarlo dos veces no cambia nada', async () => {
      await crearIntegracion(conClaveVieja().crypto.encrypt(TOKEN));

      await enRotacion().rotacion.recifrar();
      const segunda = await enRotacion().rotacion.recifrar();

      expect(segunda.recifradas).toBe(0);
    });

    it('una integracion ilegible NO impide migrar las demas', async () => {
      // Parar ahi dejaria al resto de empresas sin migrar por culpa de una.
      await crearIntegracion('basura:no:descifrable');
      const buena = await crearIntegracion(
        conClaveVieja().crypto.encrypt(TOKEN),
      );

      const r = await enRotacion().rotacion.recifrar();

      expect(r.recifradas).toBe(1);
      expect(r.ilegibles).toBeGreaterThanOrEqual(1);
      const fila = await prisma.whatsAppIntegration.findUniqueOrThrow({
        where: { id: buena },
      });
      expect(soloClaveNueva().crypto.decrypt(fila.accessTokenEncrypted!)).toBe(
        TOKEN,
      );
    });

    it('la ilegible se queda como estaba, no se corrompe mas', async () => {
      const id = await crearIntegracion('basura:no:descifrable');

      await enRotacion().rotacion.recifrar();

      const fila = await prisma.whatsAppIntegration.findUniqueOrThrow({
        where: { id },
      });
      expect(fila.accessTokenEncrypted).toBe('basura:no:descifrable');
    });
  });

  describe('cuando es seguro retirar la clave anterior', () => {
    it('NO mientras queden filas con la clave vieja', async () => {
      await crearIntegracion(conClaveVieja().crypto.encrypt(TOKEN));

      const v = await enRotacion().rotacion.sePuedeRetirarLaClaveAnterior();

      expect(v.seguro).toBe(false);
      expect(v.motivo).toMatch(/clave anterior/i);
    });

    it('NO mientras haya ilegibles: retirarla las haria irrecuperables', async () => {
      await crearIntegracion('basura:no:descifrable');

      const v = await enRotacion().rotacion.sePuedeRetirarLaClaveAnterior();

      expect(v.seguro).toBe(false);
      expect(v.motivo).toMatch(/ilegibles/i);
    });

    it('SI cuando todas usan la clave actual', async () => {
      await crearIntegracion(conClaveVieja().crypto.encrypt(TOKEN));
      await enRotacion().rotacion.recifrar();

      const v = await enRotacion().rotacion.sePuedeRetirarLaClaveAnterior();

      expect(v.seguro).toBe(true);
    });

    it('tras retirarla, todo sigue legible', async () => {
      // La comprobacion final de la rotacion completa.
      await crearIntegracion(conClaveVieja().crypto.encrypt(TOKEN));
      await enRotacion().rotacion.recifrar();

      const estado = await soloClaveNueva().rotacion.estado();

      expect(estado.conClaveActual).toBeGreaterThanOrEqual(1);
      expect(estado.rotacionEnCurso).toBe(false);
    });
  });

  describe('rollback', () => {
    it('volver a la clave vieja sigue leyendo lo NO migrado', async () => {
      // El rollback es no hacer nada: lo que no se recifro sigue como estaba.
      const id = await crearIntegracion(conClaveVieja().crypto.encrypt(TOKEN));

      const fila = await prisma.whatsAppIntegration.findUniqueOrThrow({
        where: { id },
      });
      expect(conClaveVieja().crypto.decrypt(fila.accessTokenEncrypted!)).toBe(
        TOKEN,
      );
    });

    it('lo YA migrado necesita la clave nueva: el rollback tiene limite', async () => {
      // Hay que decirlo claro en el runbook: una vez recifrada una fila,
      // volver a la clave vieja a secas la deja ilegible. El rollback seguro
      // es mantener AMBAS claves configuradas.
      const id = await crearIntegracion(conClaveVieja().crypto.encrypt(TOKEN));
      await enRotacion().rotacion.recifrar();

      const fila = await prisma.whatsAppIntegration.findUniqueOrThrow({
        where: { id },
      });
      expect(() =>
        conClaveVieja().crypto.decrypt(fila.accessTokenEncrypted!),
      ).toThrow();
    });
  });

  describe('no filtra secretos', () => {
    it('el estado no contiene el token ni la clave', async () => {
      await crearIntegracion(conClaveVieja().crypto.encrypt(TOKEN));

      const estado = await enRotacion().rotacion.estado();

      const serializado = JSON.stringify(estado);
      expect(serializado).not.toContain(TOKEN);
      expect(serializado).not.toContain(CLAVE_VIEJA);
      expect(serializado).not.toContain(CLAVE_NUEVA);
    });
  });
});
