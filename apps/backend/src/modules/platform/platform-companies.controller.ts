import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PlatformGuard } from '../../common/guards/platform.guard';
import { PlatformCompaniesService } from './platform-companies.service';
import { CreatePlatformCompanyDto } from './dto/create-platform-company.dto';
import { UpdatePlatformCompanyStatusDto } from './dto/update-platform-company-status.dto';

@UseGuards(AuthGuard('jwt'), PlatformGuard)
@Controller('platform/companies')
export class PlatformCompaniesController {
  constructor(private companiesService: PlatformCompaniesService) {}

  @Get()
  list(@Query('search') search?: string, @Query('status') status?: string) {
    return this.companiesService.listCompanies({ search, status });
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.companiesService.getCompanyDetail(id);
  }

  @Post()
  create(@Body() dto: CreatePlatformCompanyDto, @Request() req: any) {
    return this.companiesService.createCompany(dto, this.actorFromRequest(req));
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdatePlatformCompanyStatusDto,
    @Request() req: any,
  ) {
    return this.companiesService.updateCompanyStatus(
      id,
      dto.status,
      this.actorFromRequest(req),
      dto.reason,
    );
  }

  private actorFromRequest(req: any) {
    return {
      actorUserId: req.user.sub,
      actorRole: req.user.role,
      ipAddress: req.ip ?? null,
      userAgent: req.headers?.['user-agent'] ?? null,
    };
  }
}
