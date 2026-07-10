import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { RolesGuard } from '../../common/guards/roles.guard';
import { BusinessTenantGuard } from '../../common/guards/business-tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CompaniesService } from './companies.service';
import { CompanyBrandingService } from './company-branding.service';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { UploadCompanyLogoDto } from './dto/upload-company-logo.dto';

const MAX_LOGO_UPLOAD_SIZE = 2 * 1024 * 1024;

@UseGuards(AuthGuard('jwt'), BusinessTenantGuard, RolesGuard)
@Controller('companies')
export class CompaniesController {
  constructor(
    private companiesService: CompaniesService,
    private companyBrandingService: CompanyBrandingService,
  ) {}

  @Get('me')
  getMyCompany(@Request() req: any) {
    return this.companiesService.findById(req.user.companyId);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Patch('me')
  updateMyCompany(@Request() req: any, @Body() body: UpdateCompanyDto) {
    return this.companiesService.update(req.user.companyId, body);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post('me/logo')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_LOGO_UPLOAD_SIZE } }),
  )
  uploadLogo(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: UploadCompanyLogoDto,
    @Request() req: any,
  ) {
    return this.companyBrandingService.uploadLogo(
      req.user.companyId,
      file,
      body.type,
    );
  }
}
