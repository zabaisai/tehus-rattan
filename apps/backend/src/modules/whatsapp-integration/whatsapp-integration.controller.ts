import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { WhatsAppIntegrationManagementService } from './whatsapp-integration-management.service';
import { ConnectWhatsAppIntegrationDto } from './dto/connect-whatsapp-integration.dto';

@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('whatsapp-integrations')
export class WhatsAppIntegrationController {
  constructor(
    private managementService: WhatsAppIntegrationManagementService,
  ) {}

  @Get('me')
  getMyIntegration(@Request() req: any) {
    return this.managementService.getForCompany(req.user.companyId);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Put('me')
  connectOrUpdateMyIntegration(
    @Request() req: any,
    @Body() dto: ConnectWhatsAppIntegrationDto,
  ) {
    return this.managementService.connectOrUpdateForCompany(
      req.user.companyId,
      dto,
    );
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post('me/disconnect')
  disconnectMyIntegration(@Request() req: any) {
    return this.managementService.disconnectForCompany(req.user.companyId);
  }
}
