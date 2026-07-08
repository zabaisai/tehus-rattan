import {
  Controller,
  Get,
  Patch,
  Body,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { BusinessTenantGuard } from '../../common/guards/business-tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CompaniesService } from './companies.service';
import { UpdateCompanyDto } from './dto/update-company.dto';

@UseGuards(AuthGuard('jwt'), BusinessTenantGuard, RolesGuard)
@Controller('companies')
export class CompaniesController {
  constructor(private companiesService: CompaniesService) {}

  @Get('me')
  getMyCompany(@Request() req: any) {
    return this.companiesService.findById(req.user.companyId);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Patch('me')
  updateMyCompany(@Request() req: any, @Body() body: UpdateCompanyDto) {
    return this.companiesService.update(req.user.companyId, body);
  }
}
