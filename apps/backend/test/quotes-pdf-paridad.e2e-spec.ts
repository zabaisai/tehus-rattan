import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { QuotesService } from '../src/modules/quotes/quotes.service';
import { QuotePdfService } from '../src/modules/quotes/quote-pdf.service';
import { aNumeroParaMostrar } from '../src/common/dinero/dinero';
import {
  extraerTextoDePdf,
  importesDelPdf,
} from '../src/modules/quotes/quote-pdf.texto';

/**
 * BASE DE DATOS, API Y PDF DICEN LO MISMO.
 *
 * Las pruebas del contrato demuestran que el desglose es correcto, y las del
 * PDF que llega al papel. Falta la unica que cierra el circulo: que el numero
 * guardado, el que devuelve la API y el que se imprime son EL MISMO, recorriendo
 * el camino entero contra la base real.
 *
 * En staging el total coincidia y el desglose no, asi que comprobar solo el
 * total no habria detectado nada. Aqui se reconstruye la aritmetica desde las
 * cifras IMPRESAS.
 *
 * Datos con prefijo E2E-PDF, limpiados al final.
 */
const prisma = new PrismaClient();
const PREFIJO = 'E2E-PDF';
const n = (v: unknown) => Number(v);

describe('Paridad entre base, API y PDF (e2e, base real)', () => {
  const quotes = new QuotesService(prisma as unknown as PrismaService);
  const pdfService = new QuotePdfService();

  let empresa: string;
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
    contacto = (
      await prisma.contact.create({
        data: {
          companyId: empresa,
          name: `${PREFIJO} Cliente`,
          phone: '+573000000222',
        },
      })
    ).id;
    const p = await prisma.pipeline.create({
      data: { companyId: empresa, name: `${PREFIJO}-embudo` },
    });
    embudo = p.id;
    etapa = (
      await prisma.pipelineStage.create({
        data: { pipelineId: p.id, name: 'Inicial', order: 1 },
      })
    ).id;
    producto = (
      await prisma.product.create({
        data: {
          companyId: empresa,
          name: `${PREFIJO} Silla`,
          sku: `${PREFIJO}-SKU`,
          price: 250000,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.quoteItem.deleteMany({
      where: { quote: { companyId: empresa } },
    });
    await prisma.quote.deleteMany({ where: { companyId: empresa } });
    await prisma.leadProduct.deleteMany({
      where: { lead: { companyId: empresa } },
    });
    await prisma.leadStageHistory.deleteMany({
      where: { lead: { companyId: empresa } },
    });
    await prisma.lead.deleteMany({ where: { companyId: empresa } });
    await prisma.product.deleteMany({ where: { companyId: empresa } });
    await prisma.pipelineStage.deleteMany({
      where: { pipeline: { companyId: empresa } },
    });
    await prisma.pipeline.deleteMany({ where: { companyId: empresa } });
    await prisma.contact.deleteMany({ where: { companyId: empresa } });
    await prisma.company.delete({ where: { id: empresa } });
    await prisma.$disconnect();
  });

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

  /** El PDF exactamente como lo arma el endpoint. */
  async function pdfDe(quoteId: string) {
    const c = await quotes.findForPdf(quoteId, empresa);
    return pdfService.generar({
      number: c.number,
      title: c.title,
      status: c.status,
      subtotal: aNumeroParaMostrar(c.subtotal),
      lineDiscountTotal: aNumeroParaMostrar(c.lineDiscountTotal),
      discount: aNumeroParaMostrar(c.discount),
      shipping: aNumeroParaMostrar(c.shipping),
      adjustment: aNumeroParaMostrar(c.adjustment),
      adjustmentLabel: c.adjustmentLabel,
      taxRate: aNumeroParaMostrar(c.taxRate),
      taxTotal: aNumeroParaMostrar(c.taxTotal),
      taxIncluded: c.taxIncluded,
      total: aNumeroParaMostrar(c.total),
      notes: c.notes,
      validUntil: c.validUntil,
      createdAt: c.createdAt,
      company: c.company,
      lead: { title: c.lead.title },
      contact: c.lead.contact,
      items: c.items.map((i) => ({
        ...i,
        unitPrice: aNumeroParaMostrar(i.unitPrice),
        subtotal: aNumeroParaMostrar(i.subtotal),
      })),
    });
  }

  it('el caso de staging cuadra en base, API y PDF', async () => {
    const lead = await conProducto(2, 250000);
    const creada = await quotes.createFromLead(lead, empresa, undefined, {
      discount: 25000,
      shipping: 50000,
      adjustment: -15000,
      adjustmentLabel: 'Rebaja acordada',
      taxRate: 19,
    });
    const q = await quotes.update(creada.id, empresa, {
      lineas: [{ id: creada.items[0].id, lineDiscount: 100000 }],
    });

    // 1. La base.
    const enBase = await prisma.quote.findUniqueOrThrow({
      where: { id: q.id },
    });
    expect(n(enBase.total)).toBe(n(q.total));

    // 2. El papel.
    const texto = extraerTextoDePdf(await pdfDe(q.id));
    expect(texto).toContain('Subtotal bruto');
    expect(texto).toContain('Descuentos por línea');
    expect(texto).toContain('Transporte');
    expect(texto).toContain('Rebaja acordada');
    expect(texto).toContain('IVA 19%');

    // 3. La aritmética, reconstruida desde lo IMPRESO.
    const importes = importesDelPdf(texto);
    const totalImpreso = importes.at(-1)!;
    // Los de las líneas de producto van antes del bloque de totales; el
    // desglose son las últimas filas y termina en el total.
    const desglose = importes.slice(-7, -1);
    const suma = desglose.reduce((a, b) => a + b, 0);

    expect(totalImpreso).toBe(n(q.total));
    expect(suma).toBe(totalImpreso);
  });

  it('sin conceptos opcionales el papel también cuadra', async () => {
    const lead = await conProducto(1, 100000);
    const q = await quotes.createFromLead(lead, empresa, undefined, {});

    const texto = extraerTextoDePdf(await pdfDe(q.id));
    const importes = importesDelPdf(texto);

    expect(importes.at(-1)).toBe(n(q.total));
    expect(texto).not.toMatch(/transporte/i);
  });

  it('con impuesto INCLUIDO el papel dice que va dentro y el total no cambia', async () => {
    const lead = await conProducto(1, 119000);
    const q = await quotes.createFromLead(lead, empresa, undefined, {
      taxRate: 19,
      taxIncluded: true,
    });

    const texto = extraerTextoDePdf(await pdfDe(q.id));
    expect(texto).toMatch(/incluido/i);
    expect(importesDelPdf(texto).at(-1)).toBe(n(q.total));
    expect(n(q.total)).toBe(119000);
  });

  it('la etiqueta del ajuste creada llega hasta el papel', async () => {
    const lead = await conProducto(1, 100000);
    const q = await quotes.createFromLead(lead, empresa, undefined, {
      adjustment: -10000,
      adjustmentLabel: 'Descuento por pronto pago',
    });

    expect(q.adjustmentLabel).toBe('Descuento por pronto pago');
    const texto = extraerTextoDePdf(await pdfDe(q.id));
    expect(texto.replace(/\s+/g, ' ')).toContain('Descuento por pronto pago');
  });

  it('nunca aparece «NaN» en el papel', async () => {
    const lead = await conProducto(3, 33333.33);
    const q = await quotes.createFromLead(lead, empresa, undefined, {
      taxRate: 19,
      shipping: 0.5,
    });

    const texto = extraerTextoDePdf(await pdfDe(q.id));
    expect(texto).not.toContain('NaN');
    expect(importesDelPdf(texto).at(-1)).toBe(n(q.total));
  });
});
