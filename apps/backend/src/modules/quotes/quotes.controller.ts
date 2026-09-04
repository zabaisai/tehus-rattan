import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Request,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { BusinessTenantGuard } from '../../common/guards/business-tenant.guard';
import { RequiresTenantCapability } from '../../common/decorators/requires-tenant-capability.decorator';
import { TenantCapabilityGuard } from '../companies/tenant-capability.guard';
import { QuotesService } from './quotes.service';
import { QuotePdfService } from './quote-pdf.service';
import { QuoteCicloService } from './quote-ciclo.service';
import {
  DecisionCotizacionDto,
  EnviarCotizacionDto,
} from './dto/ciclo-cotizacion.dto';
import { CreateQuoteFromLeadDto } from './dto/create-quote-from-lead.dto';
import { UpdateQuoteDto } from './dto/update-quote.dto';
import { aNumeroParaMostrar } from '../../common/dinero/dinero';

@UseGuards(AuthGuard('jwt'), BusinessTenantGuard, TenantCapabilityGuard)
@RequiresTenantCapability('quotes')
@Controller('quotes')
export class QuotesController {
  constructor(
    private quotesService: QuotesService,
    private pdfService: QuotePdfService,
    private ciclo: QuoteCicloService,
  ) {}

  /**
   * Marca la cotizacion como ENVIADA y mueve la oportunidad al embudo de
   * cotizaciones configurado.
   *
   * La clave de idempotencia es OBLIGATORIA: reintentar un envio no puede
   * mandarle al cliente la misma cotizacion dos veces.
   */
  @Post(':id/enviar')
  enviar(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: EnviarCotizacionDto,
  ) {
    return this.ciclo.enviar(id, req.user.companyId, body.idempotencyKey);
  }

  /**
   * Crea una REVISION.
   *
   * Una cotizacion enviada no se edita: se revisa. Editar el documento que el
   * cliente ya tiene en la mano hace que dos personas miren cifras distintas
   * creyendo que miran la misma cotizacion.
   */
  @Post(':id/revision')
  revisar(@Param('id') id: string, @Request() req: any) {
    return this.ciclo.crearRevision(id, req.user.companyId, req.user.sub);
  }

  @Post(':id/aceptar')
  aceptar(@Param('id') id: string, @Request() req: any) {
    return this.ciclo.aceptar(id, req.user.companyId);
  }

  @Post(':id/rechazar')
  rechazar(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: DecisionCotizacionDto,
  ) {
    return this.ciclo.rechazar(id, req.user.companyId, body.motivo);
  }

  @Post(':id/cancelar')
  cancelar(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: DecisionCotizacionDto,
  ) {
    return this.ciclo.cancelar(id, req.user.companyId, body.motivo);
  }

  @Get()
  findAll(
    @Request() req: any,
    @Query('leadId') leadId?: string,
    @Query('status') status?: string,
  ) {
    return this.quotesService.findAll(req.user.companyId, { leadId, status });
  }

  /**
   * PDF de la cotizacion, generado en el servidor.
   *
   * Va ANTES de `:id` no hace falta -la ruta es mas especifica- pero se
   * mantiene junto al resto de lecturas. El `companyId` sale del token: pedir
   * el PDF de una cotizacion ajena no devuelve nada.
   */
  @Get(':id/pdf')
  async pdf(
    @Param('id') id: string,
    @Request() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cotizacion = await this.quotesService.findForPdf(
      id,
      req.user.companyId,
    );

    const pdf = await this.pdfService.generar({
      number: cotizacion.number,
      title: cotizacion.title,
      status: cotizacion.status,
      // El PDF es presentacion: recibe numeros ya redondeados a la moneda.
      // El calculo exacto ya ocurrio en el servicio, en Decimal.
      // TODOS los componentes economicos, no solo tres.
      //
      // Pasar unicamente subtotal, descuento y total es lo que produjo en
      // staging un documento donde 400.000 - 25.000 daba 487.900: el total
      // era correcto y el desglose que deberia justificarlo, no.
      subtotal: aNumeroParaMostrar(cotizacion.subtotal),
      lineDiscountTotal: aNumeroParaMostrar(cotizacion.lineDiscountTotal),
      discount: aNumeroParaMostrar(cotizacion.discount),
      shipping: aNumeroParaMostrar(cotizacion.shipping),
      adjustment: aNumeroParaMostrar(cotizacion.adjustment),
      adjustmentLabel: cotizacion.adjustmentLabel,
      taxRate: aNumeroParaMostrar(cotizacion.taxRate),
      taxTotal: aNumeroParaMostrar(cotizacion.taxTotal),
      taxIncluded: cotizacion.taxIncluded,
      total: aNumeroParaMostrar(cotizacion.total),
      notes: cotizacion.notes,
      validUntil: cotizacion.validUntil,
      createdAt: cotizacion.createdAt,
      company: cotizacion.company,
      lead: { title: cotizacion.lead.title },
      contact: cotizacion.lead.contact,
      items: cotizacion.items.map((i) => ({
        ...i,
        unitPrice: aNumeroParaMostrar(i.unitPrice),
        subtotal: aNumeroParaMostrar(i.subtotal),
      })),
    });

    res.set({
      'Content-Type': 'application/pdf',
      // `inline` y no `attachment`: lo normal es revisarlo antes de mandarlo,
      // y forzar la descarga obliga a abrir el gestor de archivos para eso.
      'Content-Disposition': `inline; filename="cotizacion-${cotizacion.number}.pdf"`,
      'Content-Length': String(pdf.length),
      // Un PDF de cotizacion no se cachea: el precio puede haber cambiado y
      // mandarle al cliente una version vieja es un problema comercial.
      'Cache-Control': 'no-store',
    });

    return new StreamableFile(pdf);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.quotesService.findById(id, req.user.companyId);
  }

  @Post('from-lead/:leadId')
  createFromLead(
    @Param('leadId') leadId: string,
    @Request() req: any,
    @Body() body: CreateQuoteFromLeadDto,
  ) {
    return this.quotesService.createFromLead(
      leadId,
      req.user.companyId,
      req.user.sub,
      body,
    );
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: UpdateQuoteDto,
  ) {
    return this.quotesService.update(id, req.user.companyId, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: any) {
    return this.quotesService.remove(id, req.user.companyId);
  }
}
