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
import { QuotesService } from './quotes.service';
import { QuotePdfService } from './quote-pdf.service';
import { CreateQuoteFromLeadDto } from './dto/create-quote-from-lead.dto';
import { UpdateQuoteDto } from './dto/update-quote.dto';

@UseGuards(AuthGuard('jwt'), BusinessTenantGuard)
@Controller('quotes')
export class QuotesController {
  constructor(
    private quotesService: QuotesService,
    private pdfService: QuotePdfService,
  ) {}

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
      subtotal: cotizacion.subtotal,
      discount: cotizacion.discount,
      total: cotizacion.total,
      notes: cotizacion.notes,
      validUntil: cotizacion.validUntil,
      createdAt: cotizacion.createdAt,
      company: cotizacion.company,
      lead: { title: cotizacion.lead.title },
      contact: cotizacion.lead.contact,
      items: cotizacion.items,
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
