import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PlatformGuard } from '../../common/guards/platform.guard';
import { SupportSessionsService } from './support-sessions.service';
import { CreateSupportSessionDto } from './dto/create-support-session.dto';

@UseGuards(AuthGuard('jwt'), PlatformGuard)
@Controller('platform/support-sessions')
export class SupportSessionsController {
  constructor(private supportSessionsService: SupportSessionsService) {}

  @Post()
  create(@Body() dto: CreateSupportSessionDto, @Request() req: any) {
    return this.supportSessionsService.createSession(
      dto,
      this.actorFromRequest(req),
    );
  }

  @Post(':id/end')
  end(@Param('id') id: string, @Request() req: any) {
    return this.supportSessionsService.endSession(
      id,
      this.actorFromRequest(req),
    );
  }

  @Get()
  list(
    @Request() req: any,
    @Query('companyId') companyId?: string,
    @Query('status') status?: string,
  ) {
    return this.supportSessionsService.listSessions(req.user.sub, {
      companyId,
      status,
    });
  }

  @Get(':id/conversations')
  listConversations(
    @Param('id') id: string,
    @Request() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.supportSessionsService.listSessionConversations(
      id,
      this.actorFromRequest(req),
      { page, limit },
    );
  }

  @Get(':id/conversations/:conversationId')
  getConversationDetail(
    @Param('id') id: string,
    @Param('conversationId') conversationId: string,
    @Request() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.supportSessionsService.getSessionConversationDetail(
      id,
      conversationId,
      this.actorFromRequest(req),
      { page, limit },
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
