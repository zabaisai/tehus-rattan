import { PrismaClient } from '@prisma/client';
import { WhatsAppIntegrationService } from '../src/modules/whatsapp-integration/whatsapp-integration.service';
import { WhatsAppNumbersService } from '../src/modules/whatsapp-integration/whatsapp-numbers.service';

/**
 * MULTI-NÚMERO — contra la base REAL, no mocks.
 *
 * Estas pruebas existen porque el riesgo del bloque 4 no está en la lógica
 * sino en el modelo: al retirar `WhatsAppIntegration.companyId @unique`,
 * ¿sigue siendo imposible que un mensaje acabe en la empresa equivocada?
 * Eso solo se responde con filas de verdad y con los constraints activos.
 *
 * Crea y limpia sus propias empresas, igual que leads-delete/leads-history.
 * Ningún dato real se toca: todo lleva el prefijo E2E-MULTINUM.
 */
const prisma = new PrismaClient();

const PREFIJO = 'E2E-MULTINUM';
const PNID_A1 = 'e2e-pnid-a1';
const PNID_A2 = 'e2e-pnid-a2';
const PNID_B1 = 'e2e-pnid-b1';

describe('WhatsApp multi-número (e2e, base real)', () => {
  let service: WhatsAppIntegrationService;
  let empresaA: string;
  let empresaB: string;

  beforeAll(async () => {
    service = new WhatsAppIntegrationService(prisma as never);

    const a = await prisma.company.create({
      data: { name: `${PREFIJO}-A`, status: 'ACTIVE' },
    });
    const b = await prisma.company.create({
      data: { name: `${PREFIJO}-B`, status: 'ACTIVE' },
    });
    empresaA = a.id;
    empresaB = b.id;

    // (a) DOS números en la MISMA empresa. Esto era imposible antes de retirar
    // el UNIQUE: la propia creación es ya parte de la prueba.
    await prisma.whatsAppIntegration.create({
      data: {
        companyId: empresaA,
        phoneNumberId: PNID_A1,
        displayPhoneNumber: '+573001110001',
        label: 'Ventas',
        status: 'CONNECTED',
        isPrimary: true,
        order: 0,
        accessTokenEncrypted: 'enc-a1',
      },
    });
    await prisma.whatsAppIntegration.create({
      data: {
        companyId: empresaA,
        phoneNumberId: PNID_A2,
        displayPhoneNumber: '+573001110002',
        label: 'Soporte',
        status: 'CONNECTED',
        isPrimary: false,
        order: 1,
        accessTokenEncrypted: 'enc-a2',
      },
    });

    // (b) Número de OTRA empresa.
    await prisma.whatsAppIntegration.create({
      data: {
        companyId: empresaB,
        phoneNumberId: PNID_B1,
        displayPhoneNumber: '+573002220001',
        label: 'Principal',
        status: 'CONNECTED',
        isPrimary: true,
        order: 0,
        accessTokenEncrypted: 'enc-b1',
      },
    });
  });

  afterAll(async () => {
    await prisma.whatsAppIntegration.deleteMany({
      where: { companyId: { in: [empresaA, empresaB] } },
    });
    await prisma.company.deleteMany({
      where: { id: { in: [empresaA, empresaB] } },
    });
    await prisma.$disconnect();
  });

  describe('a) dos números en una misma empresa', () => {
    it('la empresa tiene DOS integraciones conectadas', async () => {
      const todas = await service.findAllConnectedByCompanyId(empresaA);

      expect(todas).toHaveLength(2);
      expect(todas.map((i) => i.phoneNumberId).sort()).toEqual([
        PNID_A1,
        PNID_A2,
      ]);
    });

    it('las lista con la principal primero y sin exponer el token', async () => {
      const todas = await service.findAllConnectedByCompanyId(empresaA);

      expect(todas[0].phoneNumberId).toBe(PNID_A1);
      expect(todas[0].isPrimary).toBe(true);
      expect(todas[0]).not.toHaveProperty('accessTokenEncrypted');
      expect(JSON.stringify(todas)).not.toContain('enc-a1');
    });
  });

  describe('c) enrutamiento inbound EXCLUSIVAMENTE por phone_number_id', () => {
    it('cada número resuelve su propia empresa', async () => {
      const a1 = await service.findConnectedByPhoneNumberId(PNID_A1);
      const a2 = await service.findConnectedByPhoneNumberId(PNID_A2);
      const b1 = await service.findConnectedByPhoneNumberId(PNID_B1);

      expect(a1?.companyId).toBe(empresaA);
      expect(a2?.companyId).toBe(empresaA);
      expect(b1?.companyId).toBe(empresaB);
    });

    it('el número de la empresa B NUNCA resuelve a la empresa A', async () => {
      const b1 = await service.findConnectedByPhoneNumberId(PNID_B1);

      expect(b1?.companyId).not.toBe(empresaA);
    });

    it('un phoneNumberId desconocido no resuelve a ninguna empresa', async () => {
      await expect(
        service.findConnectedByPhoneNumberId('e2e-pnid-inexistente'),
      ).resolves.toBeNull();
    });

    it('la proyección inbound nunca incluye el token', async () => {
      const a1 = await service.findConnectedByPhoneNumberId(PNID_A1);

      expect(a1).not.toHaveProperty('accessTokenEncrypted');
    });
  });

  describe('e) fallback al número principal', () => {
    it('sin número indicado resuelve la PRINCIPAL, no una cualquiera', async () => {
      const elegida = await service.findConnectedByCompanyId(empresaA);

      expect(elegida?.phoneNumberId).toBe(PNID_A1);
      expect(elegida?.isPrimary).toBe(true);
    });

    it('si la principal se desmarca, el desempate cae en el orden declarado', async () => {
      await prisma.whatsAppIntegration.updateMany({
        where: { companyId: empresaA },
        data: { isPrimary: false },
      });

      const elegida = await service.findConnectedByCompanyId(empresaA);
      expect(elegida?.phoneNumberId).toBe(PNID_A1); // order 0 < order 1

      // Restaurar el estado para las pruebas siguientes.
      await prisma.whatsAppIntegration.update({
        where: { phoneNumberId: PNID_A1 },
        data: { isPrimary: true },
      });
    });
  });

  describe('d) envío por número explícito', () => {
    it('resuelve el número secundario cuando se pide explícitamente', async () => {
      const elegida = await service.findConnectedByCompanyAndPhoneNumberId(
        empresaA,
        PNID_A2,
      );

      expect(elegida?.phoneNumberId).toBe(PNID_A2);
      expect(elegida?.companyId).toBe(empresaA);
    });

    it('i) FUGA MULTIEMPRESA: pedir el número de B desde A no resuelve', async () => {
      // Este es el caso que justifica toda la prueba: sin el filtro por
      // companyId, la empresa A podría enviar usando el número de B.
      const intento = await service.findConnectedByCompanyAndPhoneNumberId(
        empresaA,
        PNID_B1,
      );

      expect(intento).toBeNull();
    });

    it('i) y al revés: B no puede usar un número de A', async () => {
      await expect(
        service.findConnectedByCompanyAndPhoneNumberId(empresaB, PNID_A1),
      ).resolves.toBeNull();
    });
  });

  describe('f) prohibición de dos números principales en una empresa', () => {
    it('la base RECHAZA marcar una segunda principal', async () => {
      // El índice parcial whatsapp_one_primary_per_company es el que lo impide.
      // Se comprueba contra la base, no contra la lógica del servicio.
      await expect(
        prisma.whatsAppIntegration.update({
          where: { phoneNumberId: PNID_A2 },
          data: { isPrimary: true },
        }),
      ).rejects.toThrow();

      // Y la principal original sigue siendo la única.
      const principales = await prisma.whatsAppIntegration.count({
        where: { companyId: empresaA, isPrimary: true },
      });
      expect(principales).toBe(1);
    });

    it('cada empresa puede tener SU propia principal sin conflicto', async () => {
      const pa = await prisma.whatsAppIntegration.count({
        where: { companyId: empresaA, isPrimary: true },
      });
      const pb = await prisma.whatsAppIntegration.count({
        where: { companyId: empresaB, isPrimary: true },
      });

      expect(pa).toBe(1);
      expect(pb).toBe(1);
    });
  });

  describe('g/h) alta y reconexión de números', () => {
    it('g) reconectar el MISMO phoneNumberId actualiza su integración', async () => {
      const antes = await prisma.whatsAppIntegration.count({
        where: { companyId: empresaA },
      });

      await prisma.whatsAppIntegration.upsert({
        where: { phoneNumberId: PNID_A2 },
        create: {
          companyId: empresaA,
          phoneNumberId: PNID_A2,
          status: 'CONNECTED',
          accessTokenEncrypted: 'nuevo',
        },
        update: { label: 'Soporte renombrado' },
      });

      const despues = await prisma.whatsAppIntegration.count({
        where: { companyId: empresaA },
      });
      const fila = await prisma.whatsAppIntegration.findUnique({
        where: { phoneNumberId: PNID_A2 },
      });

      expect(despues).toBe(antes); // no crea una fila nueva
      expect(fila?.label).toBe('Soporte renombrado');
    });

    it('h) conectar OTRO phoneNumberId añade una integración a la empresa', async () => {
      const antes = await prisma.whatsAppIntegration.count({
        where: { companyId: empresaA },
      });

      await prisma.whatsAppIntegration.create({
        data: {
          companyId: empresaA,
          phoneNumberId: 'e2e-pnid-a3',
          status: 'CONNECTED',
          order: 2,
          accessTokenEncrypted: 'enc-a3',
        },
      });

      const despues = await prisma.whatsAppIntegration.count({
        where: { companyId: empresaA },
      });

      expect(despues).toBe(antes + 1);
    });

    it('un phoneNumberId sigue siendo ÚNICO GLOBAL: no puede estar en dos empresas', async () => {
      // Esto es lo que hace inequívoco el enrutamiento inbound. Debe seguir
      // garantizado aunque companyId ya no sea único.
      await expect(
        prisma.whatsAppIntegration.create({
          data: {
            companyId: empresaB,
            phoneNumberId: PNID_A1, // ya pertenece a la empresa A
            status: 'CONNECTED',
            accessTokenEncrypted: 'x',
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('j) administrar los numeros desde la empresa', () => {
    let numeros: WhatsAppNumbersService;
    const actor = { userId: 'e2e-actor', role: 'ADMIN' };

    beforeAll(() => {
      // La auditoria se aisla: aqui se prueba el efecto sobre las filas de
      // integraciones, no el registro -que tiene sus propias pruebas y exige
      // un usuario real por la clave ajena.
      numeros = new WhatsAppNumbersService(
        prisma as never,
        {
          record: async () => undefined,
        } as never,
      );
    });

    it('lista solo los numeros de la empresa que pregunta', async () => {
      const deA = await numeros.listar(empresaA);

      expect(deA.length).toBeGreaterThanOrEqual(2);
      expect(deA.map((n) => n.phoneNumberId)).not.toContain(PNID_B1);
    });

    it('el listado no trae el token ni por descuido', async () => {
      const deA = await numeros.listar(empresaA);

      expect(JSON.stringify(deA)).not.toContain('enc-');
    });

    it('renombrar un numero de OTRA empresa no encuentra nada', async () => {
      const deB = await numeros.listar(empresaB);

      await expect(
        numeros.renombrar(empresaA, deB[0].id, 'Robado'),
      ).rejects.toThrow();
    });

    it('marcar principal deja EXACTAMENTE uno, con el indice parcial activo', async () => {
      const deA = await numeros.listar(empresaA);
      const noPrincipal = deA.find(
        (n) => !n.isPrimary && n.status === 'CONNECTED',
      );
      expect(noPrincipal).toBeDefined();

      await numeros.marcarPrincipal(empresaA, noPrincipal!.id, actor);

      const principales = await prisma.whatsAppIntegration.count({
        where: { companyId: empresaA, isPrimary: true },
      });
      // Si el cambio no fuera transaccional, el indice parcial habria
      // rechazado el segundo paso y aqui habria CERO.
      expect(principales).toBe(1);

      const despues = await numeros.listar(empresaA);
      expect(despues[0].id).toBe(noPrincipal!.id);
    });

    it('cambiar el principal de A no toca el de B', async () => {
      const principalesB = await prisma.whatsAppIntegration.count({
        where: { companyId: empresaB, isPrimary: true },
      });

      expect(principalesB).toBeLessThanOrEqual(1);
      const deB = await numeros.listar(empresaB);
      expect(deB.every((n) => n.phoneNumberId.startsWith('e2e-pnid-b'))).toBe(
        true,
      );
    });
  });

  describe('i) cero fuga multiempresa en los listados', () => {
    it('el listado de A no contiene ningún número de B', async () => {
      const deA = await service.findAllConnectedByCompanyId(empresaA);

      expect(deA.map((i) => i.phoneNumberId)).not.toContain(PNID_B1);
    });

    it('el listado de B no contiene ningún número de A', async () => {
      const deB = await service.findAllConnectedByCompanyId(empresaB);

      expect(deB).toHaveLength(1);
      expect(deB[0].phoneNumberId).toBe(PNID_B1);
    });

    it('resolver por empresa nunca devuelve una integración de otra', async () => {
      const a = await service.findConnectedByCompanyId(empresaA);
      const b = await service.findConnectedByCompanyId(empresaB);

      expect(a?.companyId).toBe(empresaA);
      expect(b?.companyId).toBe(empresaB);
      expect(a?.id).not.toBe(b?.id);
    });
  });
});
