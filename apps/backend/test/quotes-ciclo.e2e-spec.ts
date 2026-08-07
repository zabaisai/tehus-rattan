import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { QuoteCicloService } from '../src/modules/quotes/quote-ciclo.service';
import { QuotesService } from '../src/modules/quotes/quotes.service';

/**
 * CICLO DE VIDA DE UNA COTIZACION — contra la base real.
 *
 * Lo que se comprueba es lo que un doble no puede demostrar: que reenviar no
 * duplica, que la oportunidad acaba en el embudo CONFIGURADO —nunca en uno
 * buscado por nombre— y que una revision no pisa el documento que el cliente
 * ya tiene.
 *
 * Datos con prefijo E2E-COT, limpiados al final.
 */
const prisma = new PrismaClient();
const PREFIJO = 'E2E-COT';
const n = (v: unknown) => Number(v);

describe('Ciclo de vida de cotizaciones (e2e, base real)', () => {
  const ciclo = new QuoteCicloService(prisma as unknown as PrismaService);
  const quotes = new QuotesService(prisma as unknown as PrismaService);

  let empresaA: string;
  let empresaB: string;
  let contactoA: string;
  let embudoVentas: string;
  let etapaInicial: string;
  let embudoCotizaciones: string;
  let etapaCotizando: string;
  let i = 0;

  async function oportunidadConProductos() {
    const lead = await prisma.lead.create({
      data: {
        companyId: empresaA,
        contactId: contactoA,
        pipelineId: embudoVentas,
        stageId: etapaInicial,
        title: `${PREFIJO} venta ${i++}`,
      },
    });
    const producto = await prisma.product.create({
      data: {
        companyId: empresaA,
        name: `${PREFIJO} Sala`,
        price: '1000000',
      },
    });
    await prisma.leadProduct.create({
      data: {
        leadId: lead.id,
        productId: producto.id,
        quantity: 1,
        unitPrice: '1000000',
      },
    });
    return lead;
  }

  async function cotizacion() {
    const lead = await oportunidadConProductos();
    return quotes.createFromLead(lead.id, empresaA, undefined, {});
  }

  beforeAll(async () => {
    const a = await prisma.company.create({
      data: {
        name: `${PREFIJO}-A`,
        status: 'ACTIVE',
        quoteRoundingDecimals: 0,
      },
    });
    const b = await prisma.company.create({
      data: { name: `${PREFIJO}-B`, status: 'ACTIVE' },
    });
    empresaA = a.id;
    empresaB = b.id;

    const c = await prisma.contact.create({
      data: {
        companyId: empresaA,
        phone: '+573007776655',
        name: `${PREFIJO} Cliente`,
      },
    });
    contactoA = c.id;

    const pv = await prisma.pipeline.create({
      data: { companyId: empresaA, name: `${PREFIJO} Ventas`, isDefault: true },
    });
    const ei = await prisma.pipelineStage.create({
      data: { pipelineId: pv.id, name: 'Nuevo', order: 0, isInitial: true },
    });
    embudoVentas = pv.id;
    etapaInicial = ei.id;

    // El embudo al que van las cotizaciones. Se referencia POR ID.
    const pc = await prisma.pipeline.create({
      data: { companyId: empresaA, name: `${PREFIJO} Comercial`, order: 1 },
    });
    const ec = await prisma.pipelineStage.create({
      data: { pipelineId: pc.id, name: 'Cotizando', order: 0, isInitial: true },
    });
    embudoCotizaciones = pc.id;
    etapaCotizando = ec.id;
  });

  afterAll(async () => {
    const empresas = [empresaA, empresaB];
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
    await prisma.contact.deleteMany({ where: { companyId: { in: empresas } } });
    await prisma.companyLeadSettings.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.pipelineStage.deleteMany({
      where: { pipeline: { companyId: { in: empresas } } },
    });
    await prisma.pipeline.deleteMany({
      where: { companyId: { in: empresas } },
    });
    await prisma.company.deleteMany({ where: { id: { in: empresas } } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.companyLeadSettings.deleteMany({
      where: { companyId: empresaA },
    });
  });

  // ── envío ────────────────────────────────────────────────────

  /**
   * LA PRUEBA QUE IMPORTA.
   *
   * Reintentar un envío —porque la red falló, porque alguien pulsó dos veces—
   * no puede mandarle al cliente la misma cotización dos veces.
   */
  it('reenviar con la MISMA clave no envía dos veces', async () => {
    const c = await cotizacion();
    const clave = `${PREFIJO}-clave-${i++}`;

    const primera = await ciclo.enviar(c.id, empresaA, clave);
    const segunda = await ciclo.enviar(c.id, empresaA, clave);

    expect(primera.yaEstabaEnviada).toBe(false);
    expect(segunda.yaEstabaEnviada).toBe(true);
    expect(segunda.cotizacion.sentAt).toEqual(primera.cotizacion.sentAt);
  });

  it('la misma clave para OTRA cotización se rechaza', async () => {
    const a = await cotizacion();
    const b = await cotizacion();
    const clave = `${PREFIJO}-clave-${i++}`;

    await ciclo.enviar(a.id, empresaA, clave);

    await expect(ciclo.enviar(b.id, empresaA, clave)).rejects.toThrow(
      /ya se usó/i,
    );
  });

  it('enviar marca la fecha y deja la cotización en SENT', async () => {
    const c = await cotizacion();

    const r = await ciclo.enviar(c.id, empresaA, `${PREFIJO}-k-${i++}`);

    expect(r.cotizacion.status).toBe('SENT');
    expect(r.cotizacion.sentAt).toBeInstanceOf(Date);
  });

  // ── el embudo de cotizaciones ────────────────────────────────

  /**
   * POR ID Y NUNCA POR NOMBRE.
   *
   * Buscar un embudo llamado «Cotizaciones» rompe el día que alguien lo
   * renombra, y renombrarlo es algo que puede hacer cualquiera cualquier día.
   */
  it('mueve la oportunidad al embudo y la etapa CONFIGURADOS', async () => {
    await prisma.companyLeadSettings.create({
      data: {
        companyId: empresaA,
        quotePipelineId: embudoCotizaciones,
        quoteStageId: etapaCotizando,
      },
    });
    const c = await cotizacion();

    const r = await ciclo.enviar(c.id, empresaA, `${PREFIJO}-k-${i++}`);

    expect(r.oportunidadMovida).toBe(true);
    const lead = await prisma.lead.findUnique({ where: { id: c.leadId } });
    expect(lead!.pipelineId).toBe(embudoCotizaciones);
    expect(lead!.stageId).toBe(etapaCotizando);

    // Y deja historial: «¿por qué se movió esto?» tiene respuesta.
    const historial = await prisma.leadStageHistory.count({
      where: { leadId: c.leadId, toStageId: etapaCotizando },
    });
    expect(historial).toBe(1);
  });

  it('sin configuración NO adivina: envía y explica dónde configurarlo', async () => {
    // Mover la oportunidad a un sitio elegido por el sistema es peor que no
    // moverla, porque nadie sabe por qué se movió.
    const c = await cotizacion();
    const antes = await prisma.lead.findUnique({ where: { id: c.leadId } });

    const r = await ciclo.enviar(c.id, empresaA, `${PREFIJO}-k-${i++}`);

    expect(r.cotizacion.status).toBe('SENT');
    expect(r.oportunidadMovida).toBe(false);
    expect(r.avisoDeConfiguracion).toMatch(/Ajustes/i);

    const despues = await prisma.lead.findUnique({ where: { id: c.leadId } });
    expect(despues!.stageId).toBe(antes!.stageId);
  });

  it('una configuración que apunta a una etapa de otro embudo no mueve nada', async () => {
    await prisma.companyLeadSettings.create({
      data: {
        companyId: empresaA,
        quotePipelineId: embudoCotizaciones,
        // Etapa del embudo de ventas, no del de cotizaciones.
        quoteStageId: etapaInicial,
      },
    });
    const c = await cotizacion();

    const r = await ciclo.enviar(c.id, empresaA, `${PREFIJO}-k-${i++}`);

    expect(r.oportunidadMovida).toBe(false);
    expect(r.avisoDeConfiguracion).toMatch(/ya no es válido/i);
  });

  it('no duplica el movimiento si la oportunidad YA está en la etapa', async () => {
    await prisma.companyLeadSettings.create({
      data: {
        companyId: empresaA,
        quotePipelineId: embudoCotizaciones,
        quoteStageId: etapaCotizando,
      },
    });
    const c = await cotizacion();
    await prisma.lead.update({
      where: { id: c.leadId },
      data: { pipelineId: embudoCotizaciones, stageId: etapaCotizando },
    });

    const r = await ciclo.enviar(c.id, empresaA, `${PREFIJO}-k-${i++}`);

    expect(r.oportunidadMovida).toBe(false);
    // Y no ensucia el historial con una entrada que no significa nada.
    expect(
      await prisma.leadStageHistory.count({ where: { leadId: c.leadId } }),
    ).toBe(0);
  });

  // ── revisiones ───────────────────────────────────────────────

  /**
   * Una cotización enviada no se edita: se revisa. Editar el documento que el
   * cliente ya tiene en la mano hace que dos personas miren cifras distintas
   * creyendo que miran la misma cotización.
   */
  it('una revisión NACE en borrador y no toca la original', async () => {
    const c = await cotizacion();
    await ciclo.enviar(c.id, empresaA, `${PREFIJO}-k-${i++}`);

    const rev = await ciclo.crearRevision(c.id, empresaA);

    expect(rev.revision).toBe(2);
    expect(rev.status).toBe('DRAFT');
    expect(rev.parentQuoteId).toBe(c.id);
    expect(rev.number).toMatch(/ r2$/);
    expect(rev.items).toHaveLength(c.items.length);
    expect(n(rev.total)).toBe(n(c.total));

    // La original sigue enviada e intacta.
    const original = await prisma.quote.findUnique({ where: { id: c.id } });
    expect(original!.status).toBe('SENT');
    expect(original!.revision).toBe(1);
  });

  it('revisar una revisión sube el número sin acumular sufijos', async () => {
    const c = await cotizacion();
    const r2 = await ciclo.crearRevision(c.id, empresaA);

    const r3 = await ciclo.crearRevision(r2.id, empresaA);

    expect(r3.revision).toBe(3);
    expect(r3.number).toMatch(/ r3$/);
    expect(r3.number).not.toMatch(/r2/);
  });

  // ── aceptar, rechazar, cancelar, caducar ─────────────────────

  it('solo se acepta una cotización ENVIADA', async () => {
    const c = await cotizacion();

    await expect(ciclo.aceptar(c.id, empresaA)).rejects.toThrow(
      /envíes|envíala|enviado/i,
    );

    await ciclo.enviar(c.id, empresaA, `${PREFIJO}-k-${i++}`);
    const r = await ciclo.aceptar(c.id, empresaA);
    expect(r.status).toBe('ACCEPTED');
    expect(r.acceptedAt).toBeInstanceOf(Date);
  });

  it('una cotización aceptada no se puede reenviar', async () => {
    const c = await cotizacion();
    await ciclo.enviar(c.id, empresaA, `${PREFIJO}-k-${i++}`);
    await ciclo.aceptar(c.id, empresaA);

    await expect(
      ciclo.enviar(c.id, empresaA, `${PREFIJO}-k-${i++}`),
    ).rejects.toThrow(/ya fue aceptada/i);
  });

  it('rechazar guarda el motivo', async () => {
    const c = await cotizacion();
    await ciclo.enviar(c.id, empresaA, `${PREFIJO}-k-${i++}`);

    const r = await ciclo.rechazar(c.id, empresaA, 'precio alto');

    expect(r.status).toBe('REJECTED');
    const fila = await prisma.quote.findUnique({ where: { id: c.id } });
    expect(fila!.rejectionReason).toBe('precio alto');
  });

  it('las vencidas caducan: una «enviada» vencida haría honrar un precio viejo', async () => {
    const c = await cotizacion();
    await ciclo.enviar(c.id, empresaA, `${PREFIJO}-k-${i++}`);
    await prisma.quote.update({
      where: { id: c.id },
      data: { validUntil: new Date('2020-01-01') },
    });

    const r = await ciclo.caducarVencidas(empresaA);

    expect(r.caducadas).toBeGreaterThanOrEqual(1);
    const fila = await prisma.quote.findUnique({ where: { id: c.id } });
    expect(fila!.status).toBe('EXPIRED');
  });

  // ── aislamiento ──────────────────────────────────────────────

  it('NO se puede enviar la cotización de otra empresa', async () => {
    const c = await cotizacion();

    await expect(
      ciclo.enviar(c.id, empresaB, `${PREFIJO}-k-${i++}`),
    ).rejects.toThrow();

    const fila = await prisma.quote.findUnique({ where: { id: c.id } });
    expect(fila!.status).toBe('DRAFT');
  });

  it('NO se puede revisar la cotización de otra empresa', async () => {
    const c = await cotizacion();
    await expect(ciclo.crearRevision(c.id, empresaB)).rejects.toThrow();
  });
});
