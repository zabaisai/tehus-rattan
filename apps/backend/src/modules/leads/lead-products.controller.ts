import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { BusinessTenantGuard } from '../../common/guards/business-tenant.guard';
import { LeadProductsService } from './lead-products.service';
import { CreateLeadProductDto } from './dto/create-lead-product.dto';
import { UpdateLeadProductDto } from './dto/update-lead-product.dto';

@UseGuards(AuthGuard('jwt'), BusinessTenantGuard)
@Controller('leads/:leadId/products')
export class LeadProductsController {
  constructor(private leadProductsService: LeadProductsService) {}

  @Get()
  findAll(@Param('leadId') leadId: string, @Request() req: any) {
    return this.leadProductsService.findAllForLead(leadId, req.user.companyId);
  }

  @Post()
  add(
    @Param('leadId') leadId: string,
    @Request() req: any,
    @Body() body: CreateLeadProductDto,
  ) {
    return this.leadProductsService.addProduct(leadId, req.user.companyId, body);
  }

  @Patch(':leadProductId')
  update(
    @Param('leadId') leadId: string,
    @Param('leadProductId') leadProductId: string,
    @Request() req: any,
    @Body() body: UpdateLeadProductDto,
  ) {
    return this.leadProductsService.update(
      leadId,
      leadProductId,
      req.user.companyId,
      body,
    );
  }

  @Delete(':leadProductId')
  remove(
    @Param('leadId') leadId: string,
    @Param('leadProductId') leadProductId: string,
    @Request() req: any,
  ) {
    return this.leadProductsService.remove(leadId, leadProductId, req.user.companyId);
  }
}
