import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { CompaniesController } from '../src/modules/companies/companies.controller';
import { CompaniesService } from '../src/modules/companies/companies.service';
import { CompanyBrandingService } from '../src/modules/companies/company-branding.service';
import { TenantConfigurationService } from '../src/modules/companies/tenant-configuration.service';
import { PlatformAuditLogService } from '../src/modules/platform/platform-audit-log.service';
import { ProductsController } from '../src/modules/products/products.controller';
import { ProductsService } from '../src/modules/products/products.service';
import { ImportacionDeProductosService } from '../src/modules/products/import/importacion.service';
import { ImportacionQueue } from '../src/modules/products/import/importacion.queue';
import {
  MigracionDeInquilinosService,
  MIGRACION_AUDIT_ACTION,
  type Manifiesto,
} from '../src/modules/companies/migracion/migracion-de-inquilinos.service';
import {
  crearAppHttp,
  crearEmpresaE2E,
  limpiarEmpresasE2E,
  tokenDe,
  type EmpresaE2E,
} from './helpers/tenant-http';

/**
 * FASE 5 — migración de las empresas existentes, de extremo a extremo sobre
 * PostgreSQL real.
 *
 * Se comprueba lo que de verdad importa: que la configuración efectiva que
 * sirve la API es IDÉNTICA antes y después, que los elementos de catálogo se
 * ven igual, que una segunda ejecución no cambia nada y que la reversión
 * devuelve el estado exacto anterior.
 *
 * Empresas temporales `E2E-MIG5-*`, borradas por id al final. La migración se
 * ejecuta SIEMPRE acotada a esas empresas: nunca toca el resto de la base.
 */
const PREFIJO = 'E2E-MIG5';

describe('Fase 5 — migración de empresas existentes', () => {
  const prisma = new PrismaService();
  let app: INestApplication;
  let jwt: JwtService;
  let migracion: MigracionDeInquilinosService;
  const creadas: EmpresaE2E[] = [];

  beforeAll(async () => {
    migracion = new MigracionDeInquilinosService(prisma);
    const montada = await crearAppHttp({
      prisma,
      controllers: [CompaniesController, ProductsController],
      providers: [
        CompaniesService,
        CompanyBrandingService,
        TenantConfigurationService,
        PlatformAuditLogService,
        ProductsService,
        ImportacionDeProductosService,
        { provide: ImportacionQueue, useValue: { encolar: jest.fn() } },
      ],
    });
    app = montada.app;
    jwt = montada.jwt;
  });

  afterAll(async () => {
    await limpiarEmpresasE2E(prisma, creadas);
    await app.close();
    await prisma.$disconnect();
  });

  async function nuevaEmpresa(
    data: Parameters<typeof crearEmpresaE2E>[2] = {},
  ): Promise<EmpresaE2E> {
    const empresa = await crearEmpresaE2E(prisma, PREFIJO, data);
    creadas.push(empresa);
    return empresa;
  }

  /** Fila de catálogo con el tipo que se pida, incluido NULL (fila anterior). */
  async function crearElemento(
    companyId: string,
    name: string,
    itemType: 'PRODUCT' | 'SERVICE' | null,
  ) {
    const fila = await prisma.product.create({
      data: { name, price: 1000, companyId, itemType },
      select: { id: true },
    });
    return fila.id;
  }

  function configuracionDe(empresa: EmpresaE2E) {
    return request(app.getHttpServer())
      .get('/api/companies/me/configuration')
      .set('Authorization', `Bearer ${tokenDe(jwt, empresa, 'admin')}`)
      .expect(200)
      .then((res) => res.body);
  }

  function catalogoDe(empresa: EmpresaE2E) {
    return request(app.getHttpServer())
      .get('/api/products')
      .set('Authorization', `Bearer ${tokenDe(jwt, empresa, 'admin')}`)
      .expect(200)
      .then((res) => res.body);
  }

  it('el ensayo en seco planifica sin escribir absolutamente nada', async () => {
    const empresa = await nuevaEmpresa({ settings: null });
    await crearElemento(empresa.companyId, `${PREFIJO} sin tipo`, null);

    const antes = await prisma.company.findUniqueOrThrow({
      where: { id: empresa.companyId },
      select: { settings: true },
    });

    const { plan } = await migracion.ensayoEnSeco([empresa.companyId]);

    expect(plan.totales.canonicalizar).toBe(1);
    expect(plan.totales.filasDeCatalogo).toBe(1);

    const despues = await prisma.company.findUniqueOrThrow({
      where: { id: empresa.companyId },
      select: { settings: true },
    });
    expect(despues.settings).toEqual(antes.settings);
    expect(
      await prisma.product.count({
        where: { companyId: empresa.companyId, itemType: null },
      }),
    ).toBe(1);
  });

  it('una empresa sin configuración conserva su comportamiento exacto al migrar', async () => {
    const empresa = await nuevaEmpresa({ settings: null });
    await crearElemento(empresa.companyId, `${PREFIJO} legacy`, null);

    const antes = await configuracionDe(empresa);
    const catalogoAntes = await catalogoDe(empresa);

    expect(antes.storageVersion).toBe(0);
    expect(antes.capabilities.legacyDefaultsApplied.sort()).toEqual([
      'catalog',
      'quotes',
      'tasks',
    ]);

    await migracion.aplicar([empresa.companyId]);

    const despues = await configuracionDe(empresa);
    const catalogoDespues = await catalogoDe(empresa);

    // Lo único que cambia: deja de depender de valores por compatibilidad.
    expect(despues.storageVersion).toBe(2);
    expect(despues.capabilities.legacyDefaultsApplied).toEqual([]);

    // Todo lo demás es idéntico, campo por campo.
    expect(despues.modules).toEqual(antes.modules);
    expect(despues.identity).toEqual(antes.identity);
    expect(despues.regional).toEqual(antes.regional);
    expect(despues.capabilities.catalog).toEqual(antes.capabilities.catalog);
    expect(despues.catalog).toEqual(antes.catalog);
    expect(despues.pipeline).toEqual(antes.pipeline);

    // El catálogo se ve igual: la fila anterior ya se leía como producto.
    expect(catalogoDespues).toEqual(catalogoAntes);
    expect(catalogoDespues[0].itemType).toBe('PRODUCT');
  });

  it('la fila anterior queda escrita como producto y no queda ninguna sin tipo', async () => {
    const empresa = await nuevaEmpresa({ settings: null });
    const sinTipo = await crearElemento(
      empresa.companyId,
      `${PREFIJO} a`,
      null,
    );
    const servicio = await crearElemento(
      empresa.companyId,
      `${PREFIJO} b`,
      'SERVICE',
    );

    await migracion.aplicar([empresa.companyId]);

    const filas = await prisma.product.findMany({
      where: { id: { in: [sinTipo, servicio] } },
      select: { id: true, itemType: true },
      orderBy: { id: 'asc' },
    });
    const porId = new Map(filas.map((f) => [f.id, f.itemType]));

    expect(porId.get(sinTipo)).toBe('PRODUCT');
    // Un servicio no se toca jamás.
    expect(porId.get(servicio)).toBe('SERVICE');
  });

  it('no altera la fecha de actualización: la fila no cambió para el negocio', async () => {
    // La migración escribe el tipo que la API ya devolvía. Tocar `updatedAt`
    // afirmaría una edición que nunca ocurrió y ensuciaría el catálogo entero.
    const empresa = await nuevaEmpresa({ settings: null });
    const fila = await crearElemento(
      empresa.companyId,
      `${PREFIJO} fecha`,
      null,
    );

    const antes = await prisma.product.findUniqueOrThrow({
      where: { id: fila },
      select: { updatedAt: true, createdAt: true },
    });

    await migracion.aplicar([empresa.companyId]);

    const despues = await prisma.product.findUniqueOrThrow({
      where: { id: fila },
      select: { updatedAt: true, createdAt: true, itemType: true },
    });

    expect(despues.itemType).toBe('PRODUCT');
    expect(despues.updatedAt).toEqual(antes.updatedAt);
    expect(despues.createdAt).toEqual(antes.createdAt);
  });

  it('una segunda ejecución no cambia nada: la migración es idempotente', async () => {
    const empresa = await nuevaEmpresa({
      settings: { sellsProducts: true, usesCatalog: true },
    });
    await crearElemento(empresa.companyId, `${PREFIJO} idem`, null);

    await migracion.aplicar([empresa.companyId]);

    const trasPrimera = await prisma.company.findUniqueOrThrow({
      where: { id: empresa.companyId },
      select: { settings: true },
    });

    const segunda = await migracion.aplicar([empresa.companyId]);

    expect(segunda.filasDeCatalogoActualizadas).toBe(0);
    expect(segunda.empresasCanonicalizadas).toBe(0);

    const trasSegunda = await prisma.company.findUniqueOrThrow({
      where: { id: empresa.companyId },
      select: { settings: true },
    });
    expect(trasSegunda.settings).toEqual(trasPrimera.settings);

    const verificacion = await migracion.verificar([empresa.companyId]);
    expect(verificacion.ok).toBe(true);
    expect(verificacion.problemas).toEqual([]);
  });

  it('una bandera que nunca se declaró queda escrita como activa', async () => {
    // `usesTasks` no está: hoy se lee activa por compatibilidad y así debe
    // quedar guardada, o la empresa perdería el módulo.
    const empresa = await nuevaEmpresa({
      settings: { sellsServices: true, usesCatalog: true, usesQuotes: false },
    });

    const antes = await configuracionDe(empresa);
    await migracion.aplicar([empresa.companyId]);
    const despues = await configuracionDe(empresa);

    expect(antes.modules.tasks).toBe(true);
    expect(despues.modules.tasks).toBe(true);
    expect(despues.modules.quotes).toBe(false);
    expect(despues.identity.businessModel).toBe(antes.identity.businessModel);

    const guardado = await prisma.company.findUniqueOrThrow({
      where: { id: empresa.companyId },
      select: { settings: true },
    });
    expect(
      (guardado.settings as { commercial: Record<string, boolean> }).commercial,
    ).toEqual({
      sellsProducts: false,
      sellsServices: true,
      usesCatalog: true,
      usesQuotes: false,
      usesTasks: true,
    });
  });

  it('conserva las claves desconocidas de la configuración guardada', async () => {
    const empresa = await nuevaEmpresa({
      settings: {
        sellsProducts: true,
        sellsServices: false,
        usesCatalog: true,
        usesQuotes: true,
        usesTasks: true,
        integracionPropia: { activa: true, nivel: 3 },
      },
    });

    await migracion.aplicar([empresa.companyId]);

    const guardado = await prisma.company.findUniqueOrThrow({
      where: { id: empresa.companyId },
      select: { settings: true },
    });
    expect(
      (guardado.settings as Record<string, unknown>).integracionPropia,
    ).toEqual({ activa: true, nivel: 3 });
  });

  it('una empresa ambigua no se toca y se informa el motivo', async () => {
    const empresa = await nuevaEmpresa({
      settings: {
        sellsProducts: true,
        sellsServices: false,
        usesCatalog: true,
        usesQuotes: true,
        usesTasks: true,
        // La normalización deduplicaría esta lista: hay que revisarla a mano.
        categories: ['Ropa', 'ropa'],
      },
    });

    const antes = await prisma.company.findUniqueOrThrow({
      where: { id: empresa.companyId },
      select: { settings: true },
    });

    const resultado = await migracion.aplicar([empresa.companyId]);

    expect(resultado.empresasCanonicalizadas).toBe(0);
    expect(resultado.manifiesto.ambiguas).toHaveLength(1);
    expect(resultado.manifiesto.ambiguas[0].motivos.join(' ')).toContain(
      'categorías',
    );

    const despues = await prisma.company.findUniqueOrThrow({
      where: { id: empresa.companyId },
      select: { settings: true },
    });
    expect(despues.settings).toEqual(antes.settings);

    // Y la verificación lo refleja en lugar de dar la migración por buena.
    const verificacion = await migracion.verificar([empresa.companyId]);
    expect(verificacion.ok).toBe(false);
  });

  it('deja una fila de auditoría por empresa, sin valores de configuración', async () => {
    const empresa = await nuevaEmpresa({ settings: null });

    await migracion.aplicar([empresa.companyId]);

    const filas = await prisma.auditLog.findMany({
      where: {
        affectedCompanyId: empresa.companyId,
        action: MIGRACION_AUDIT_ACTION,
      },
      select: { actorUserId: true, metadata: true, entityType: true },
    });

    expect(filas).toHaveLength(1);
    // Acción de sistema: no se suplanta a ninguna persona.
    expect(filas[0].actorUserId).toBeNull();
    expect(filas[0].entityType).toBe('Company');

    const metadata = filas[0].metadata as Record<string, unknown>;
    expect(metadata.storageVersion).toEqual({ antes: 0, despues: 2 });
    // La auditoría no lleva banderas, categorías ni nombres.
    expect(JSON.stringify(metadata)).not.toContain('sellsProducts');
    expect(JSON.stringify(metadata)).not.toContain(PREFIJO);
  });

  it('la reversión desde el manifiesto devuelve el estado exacto anterior', async () => {
    const empresa = await nuevaEmpresa({ settings: null });
    const fila = await crearElemento(
      empresa.companyId,
      `${PREFIJO} revertir`,
      null,
    );

    const antesSettings = await prisma.company.findUniqueOrThrow({
      where: { id: empresa.companyId },
      select: { settings: true },
    });

    const resultado = await migracion.aplicar([empresa.companyId]);
    const manifiesto: Manifiesto = resultado.manifiesto;

    expect(
      (
        await prisma.product.findUniqueOrThrow({
          where: { id: fila },
          select: { itemType: true },
        })
      ).itemType,
    ).toBe('PRODUCT');

    const revertido = await migracion.revertir(manifiesto);

    expect(revertido.filasRevertidas).toBe(1);
    expect(revertido.empresasRevertidas).toBe(1);

    // La configuración vuelve a no existir, no a un objeto vacío.
    const despues = await prisma.company.findUniqueOrThrow({
      where: { id: empresa.companyId },
      select: { settings: true },
    });
    expect(despues.settings).toEqual(antesSettings.settings);
    expect(despues.settings).toBeNull();

    // Y la fila vuelve a no tener tipo.
    expect(
      (
        await prisma.product.findUniqueOrThrow({
          where: { id: fila },
          select: { itemType: true },
        })
      ).itemType,
    ).toBeNull();
  });

  it('el alcance acota de verdad: una empresa fuera de la lista no se toca', async () => {
    const dentro = await nuevaEmpresa({ settings: null });
    const fuera = await nuevaEmpresa({ settings: null });

    await migracion.aplicar([dentro.companyId]);

    const sinTocar = await prisma.company.findUniqueOrThrow({
      where: { id: fuera.companyId },
      select: { settings: true },
    });
    expect(sinTocar.settings).toBeNull();
  });
});
