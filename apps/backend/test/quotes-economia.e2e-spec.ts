import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { QuotesService } from '../src/modules/quotes/quotes.service';

/**
 * ECONOMIA DE LA COTIZACION — contra la base real.
 *
 * EL DEFECTO QUE ESTO CUBRE: el motor de calculo soportaba transporte,
 * impuesto, ajuste y descuentos por linea desde el primer dia, con sus pruebas
 * en verde, y NO SE PODIA USAR: los DTO no declaraban esos campos y la API
 * contestaba «property shipping should not exist».
 *
 * Estas pruebas recorren servicio + base, y las de la capa de validacion viven
 * en `dto/economia-cotizacion.dto.spec.ts`. Entre las dos cubren el camino que
 * ninguna prueba anterior tocaba: el que va del cuerpo de la peticion al total
 * guardado.
 *
 * Datos con prefijo E2E-ECO, limpiados al final.
 */
const prisma = new PrismaClient();
const PREFIJO = 'E2E-ECO';
const n = (v: unknown) => Number(v);

describe('Economía de cotizaciones (e2e, base real)', () => {
  const quotes = new QuotesService(prisma as unknown as PrismaService);

  let empresa: string;
  let empresaAjena: string;
  let contacto: string;
  let embudo: string;
  let etapa: string;
  let producto: string;

  beforeAll(async () => {
    const e = await prisma.company.create({
      data: {
        name: `${PREFIJO}-empresa`,
        status: 'ACTIVE',
        currency: 'COP',
        quoteRoundingDecimals: 0,
        defaultTaxRate: 0,
        taxIncluded: false,
      },
    });
    empresa = e.id;
    const otra = await prisma.company.create({
      data: { name: `${PREFIJO}-ajena`, status: 'ACTIVE' },
    });
    empresaAjena = otra.id;

    const c = await prisma.contact.create({
      data: {
        companyId: empresa,
        name: `${PREFIJO} Cliente`,
        phone: '+573000000111',
      },
    });
    contacto = c.id;

    const p = await prisma.pipeline.create({
      data: { companyId: empresa, name: `${PREFIJO}-embudo` },
    });
    embudo = p.id;
    const s = await prisma.pipelineStage.create({
      data: { pipelineId: p.id, name: 'Inicial', order: 1 },
    });
    etapa = s.id;

    const prod = await prisma.product.create({
      data: {
        companyId: empresa,
        name: `${PREFIJO} Silla`,
        sku: `${PREFIJO}-SKU`,
        price: 250000,
      },
    });
    producto = prod.id;
  });

  afterAll(async () => {
    const empresas = [empresa, empresaAjena];
    await prisma.quoteItem.deleteMany({
      where: { quote: { companyId: { in: empresas } } },
    });
    await prisma.quote.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.leadProduct.deleteMany({
      where: { lead: { companyId: { in: empresas } } },
    });
    await prisma.leadStageHistory.deleteMany({
      where: { lead: { companyId: { in: empresas } } },
    });
    await prisma.lead.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.product.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.pipelineStage.deleteMany({
      where: { pipeline: { companyId: { in: empresas } } },
    });
    await prisma.pipeline.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.contact.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.company.deleteMany({ where: { id: { in: empresas } } });
    await prisma.$disconnect();
  });

  /** Oportunidad con `unidades` del producto, listo para cotizar. */
  async function conProducto(unidades = 2, precio = 250000) {
    const lead = await prisma.lead.create({
      data: {
        companyId: empresa,
        title: `${PREFIJO} oportunidad`,
        contactId: contacto,
        pipelineId: embudo,
        stageId: etapa,
      },
    });
    await prisma.leadProduct.create({
      data: {
        leadId: lead.id,
        productId: producto,
        quantity: unidades,
        unitPrice: precio,
      },
    });
    return lead.id;
  }

  // ── creación con todos los conceptos ─────────────────────────

  it('crea una cotización con transporte, ajuste e impuesto en el orden correcto', async () => {
    const lead = await conProducto(2, 250000);

    const q = await quotes.createFromLead(lead, empresa, undefined, {
      discount: 25000,
      shipping: 50000,
      adjustment: 5000,
      taxRate: 19,
      taxIncluded: false,
    });

    // 2 x 250.000 = 500.000
    // − 25.000 descuento + 50.000 transporte + 5.000 ajuste = 530.000
    // + 19 % = 100.700  →  630.700
    expect(n(q.subtotal)).toBe(500000);
    expect(n(q.discount)).toBe(25000);
    expect(n(q.shipping)).toBe(50000);
    expect(n(q.adjustment)).toBe(5000);
    expect(n(q.taxTotal)).toBe(100700);
    expect(n(q.total)).toBe(630700);
  });

  /**
   * LA ETIQUETA DEL AJUSTE SE ACEPTABA Y SE PERDIA.
   *
   * El DTO la declara, asi que la peticion pasa la validacion y devuelve 201,
   * pero `createFromLead` no la guardaba: quien la escribia al crear veia un
   * ajuste sin concepto en el documento y no habia forma de saber por que.
   *
   * Editar despues si funcionaba, lo que lo hacia aun mas confuso.
   */
  it('la etiqueta del ajuste se PERSISTE al crear, no solo al editar', async () => {
    const lead = await conProducto(1, 100000);

    const q = await quotes.createFromLead(lead, empresa, undefined, {
      adjustment: -10000,
      adjustmentLabel: 'Rebaja acordada',
    });

    expect(q.adjustmentLabel).toBe('Rebaja acordada');
  });

  it('crear y editar dejan la etiqueta igual', async () => {
    const lead = await conProducto(1, 100000);
    const creada = await quotes.createFromLead(lead, empresa, undefined, {
      adjustment: -5000,
      adjustmentLabel: '  Rebaja  con  espacios  ',
    });
    const editada = await quotes.update(creada.id, empresa, {
      adjustmentLabel: '  Rebaja  con  espacios  ',
    });

    // Mismo valor por los dos caminos, y con los espacios ya normalizados.
    expect(creada.adjustmentLabel).toBe(editada.adjustmentLabel);
    expect(creada.adjustmentLabel).toBe('Rebaja con espacios');
  });

  it('sin ajuste no se guarda etiqueta: no hay nada que etiquetar', async () => {
    const lead = await conProducto(1, 100000);
    const q = await quotes.createFromLead(lead, empresa, undefined, {
      adjustmentLabel: 'Etiqueta huérfana',
    });
    expect(q.adjustmentLabel).toBeNull();
  });

  it('con IVA INCLUIDO el impuesto se extrae, no se suma', async () => {
    const lead = await conProducto(1, 119000);

    const q = await quotes.createFromLead(lead, empresa, undefined, {
      taxRate: 19,
      taxIncluded: true,
    });

    // Confundir esto con «sumar el 19 %» desvía el total un 19 % entero.
    expect(n(q.total)).toBe(119000);
    expect(n(q.taxTotal)).toBe(19000);
  });

  it('un ajuste NEGATIVO baja el total', async () => {
    const lead = await conProducto(1, 100000);

    const q = await quotes.createFromLead(lead, empresa, undefined, {
      adjustment: -10000,
    });

    expect(n(q.adjustment)).toBe(-10000);
    expect(n(q.total)).toBe(90000);
  });

  // ── actualización: el servidor manda ─────────────────────────

  it('actualizar recalcula el total desde las líneas persistidas', async () => {
    const lead = await conProducto(2, 250000);
    const q = await quotes.createFromLead(lead, empresa, undefined, {});
    expect(n(q.total)).toBe(500000);

    const actualizada = await quotes.update(q.id, empresa, {
      shipping: 30000,
      taxRate: 19,
    });

    expect(n(actualizada.shipping)).toBe(30000);
    expect(n(actualizada.taxTotal)).toBe(100700);
    expect(n(actualizada.total)).toBe(630700);
  });

  it('el descuento por línea baja el subtotal y queda registrado', async () => {
    const lead = await conProducto(2, 250000);
    const q = await quotes.createFromLead(lead, empresa, undefined, {});
    const linea = q.items[0];

    const actualizada = await quotes.update(q.id, empresa, {
      lineas: [{ id: linea.id, lineDiscount: 100000 }],
    });

    expect(n(actualizada.lineDiscountTotal)).toBe(100000);
    expect(n(actualizada.subtotal)).toBe(400000);
    expect(n(actualizada.total)).toBe(400000);
    expect(n(actualizada.items[0].lineDiscount)).toBe(100000);
  });

  it('cambiar la cantidad de una línea recalcula todo', async () => {
    const lead = await conProducto(2, 250000);
    const q = await quotes.createFromLead(lead, empresa, undefined, {});

    const actualizada = await quotes.update(q.id, empresa, {
      lineas: [{ id: q.items[0].id, quantity: 4 }],
    });

    expect(actualizada.items[0].quantity).toBe(4);
    expect(n(actualizada.total)).toBe(1000000);
  });

  /**
   * EL CLIENTE NO PONE EL TOTAL.
   *
   * Aunque el DTO ya lo rechaza, esto comprueba la otra mitad: que el servicio
   * lo recalcula y no lo copia. Una capa de validación se puede saltar; una
   * cuenta hecha en el servidor, no.
   */
  it('un total enviado a mano se ignora: manda el cálculo', async () => {
    const lead = await conProducto(1, 100000);
    const q = await quotes.createFromLead(lead, empresa, undefined, {});

    const actualizada = await quotes.update(q.id, empresa, {
      total: 1,
      subtotal: 1,
      taxTotal: 1,
    } as never);

    expect(n(actualizada.total)).toBe(100000);
    expect(n(actualizada.subtotal)).toBe(100000);
  });

  it('rechaza un ajuste que deja el total en negativo', async () => {
    const lead = await conProducto(1, 100000);
    const q = await quotes.createFromLead(lead, empresa, undefined, {});

    await expect(
      quotes.update(q.id, empresa, { adjustment: -500000 }),
    ).rejects.toThrow(/por debajo de cero/i);
  });

  it('rechaza una línea que no pertenece a la cotización', async () => {
    const lead = await conProducto(1, 100000);
    const q = await quotes.createFromLead(lead, empresa, undefined, {});

    await expect(
      quotes.update(q.id, empresa, {
        lineas: [{ id: 'linea-de-otro-documento', lineDiscount: 1 }],
      }),
    ).rejects.toThrow(/no pertenece/i);
  });

  // ── ciclo de vida y aislamiento ──────────────────────────────

  it('una cotización ya enviada no cambia sus importes', async () => {
    const lead = await conProducto(1, 100000);
    const q = await quotes.createFromLead(lead, empresa, undefined, {});
    await prisma.quote.update({
      where: { id: q.id },
      data: { status: 'SENT' },
    });

    // Cambiarle los números por debajo la convierte en otro documento con el
    // mismo número; para eso existe la revisión.
    await expect(
      quotes.update(q.id, empresa, { shipping: 1000 }),
    ).rejects.toThrow(/borrador/i);

    // Pero lo que no toca los importes sí se puede seguir editando.
    await expect(
      quotes.update(q.id, empresa, { notes: 'Enviada al cliente' }),
    ).resolves.toBeDefined();
  });

  it('otra empresa no puede tocar esta cotización', async () => {
    const lead = await conProducto(1, 100000);
    const q = await quotes.createFromLead(lead, empresa, undefined, {});

    await expect(
      quotes.update(q.id, empresaAjena, { shipping: 1000 }),
    ).rejects.toThrow(/no encontrada/i);
  });

  it('el redondeo de la empresa manda sobre el resultado', async () => {
    // 3 x 33.333,33 con 19 % son decimales que hay que cerrar en algún sitio;
    // el sitio lo decide la empresa, y queda congelado en el documento.
    const lead = await conProducto(3, 33333.33);
    const q = await quotes.createFromLead(lead, empresa, undefined, {
      taxRate: 19,
    });

    expect(q.roundingDecimals).toBe(0);
    expect(Number.isInteger(n(q.total))).toBe(true);
  });
});
