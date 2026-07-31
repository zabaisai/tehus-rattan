import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { BusinessTenantGuard } from '../../common/guards/business-tenant.guard';
import { NotificationsService } from './notifications.service';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';

// Every endpoint is scoped to the authenticated user: recipientUserId is always
// req.user.sub and companyId always req.user.companyId — a client can never
// read or mutate another user's (or another company's) notifications.
// `BusinessTenantGuard` ademas de la sesion: sin el, un SUPER_ADMIN de
// PLATAFORMA (companyId null) alcanza este endpoint. No filtraria datos
// -ninguna notificacion tiene companyId null-, pero el panel de plataforma
// esta deliberadamente aislado de los endpoints de negocio, y una via de
// entrada que "no devuelve nada por casualidad" es una garantia que depende
// de los datos en vez de del control de acceso.
@UseGuards(AuthGuard('jwt'), BusinessTenantGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get()
  list(@Request() req: any, @Query() query: ListNotificationsDto) {
    return this.notifications.listForUser(req.user.sub, req.user.companyId, {
      unread: query.unread === 'true',
      category: query.category,
      priority: query.priority,
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Get('unread-count')
  async unreadCount(@Request() req: any) {
    const count = await this.notifications.unreadCount(
      req.user.sub,
      req.user.companyId,
    );
    return { count };
  }

  @Get('preferences')
  getPreferences(@Request() req: any) {
    return this.notifications.getPreferences(req.user.sub, req.user.companyId);
  }

  @Put('preferences')
  updatePreferences(@Request() req: any, @Body() dto: UpdatePreferencesDto) {
    return this.notifications.updatePreferences(
      req.user.sub,
      req.user.companyId,
      dto.preferences,
    );
  }

  @HttpCode(200)
  @Post(':id/read')
  async markRead(@Request() req: any, @Param('id') id: string) {
    const updated = await this.notifications.markRead(id, req.user.sub);
    return { updated };
  }

  @HttpCode(200)
  @Post('read-all')
  async markAllRead(@Request() req: any) {
    const count = await this.notifications.markAllRead(
      req.user.sub,
      req.user.companyId,
    );
    return { count };
  }
}
