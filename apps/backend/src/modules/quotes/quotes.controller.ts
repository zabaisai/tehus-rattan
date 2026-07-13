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
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { BusinessTenantGuard } from '../../common/guards/business-tenant.guard';
import { QuotesService } from './quotes.service';
import { CreateQuoteFromLeadDto } from './dto/create-quote-from-lead.dto';
import { UpdateQuoteDto } from './dto/update-quote.dto';

@UseGuards(AuthGuard('jwt'), BusinessTenantGuard)
@Controller('quotes')
export class QuotesController {
  constructor(private quotesService: QuotesService) {}

  @Get()
  findAll(
    @Request() req: any,
    @Query('leadId') leadId?: string,
    @Query('status') status?: string,
  ) {
    return this.quotesService.findAll(req.user.companyId, { leadId, status });
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
