import { Controller, Get, Patch, Body, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CompaniesService } from './companies.service';

@UseGuards(AuthGuard('jwt'))
@Controller('companies')
export class CompaniesController {
  constructor(private companiesService: CompaniesService) {}

  @Get('me')
  getMyCompany(@Request() req: any) {
    return this.companiesService.findById(req.user.companyId);
  }

  @Patch('me')
  updateMyCompany(
    @Request() req: any,
    @Body() body: { name?: string; phone?: string },
  ) {
    return this.companiesService.update(req.user.companyId, body);
  }
}
