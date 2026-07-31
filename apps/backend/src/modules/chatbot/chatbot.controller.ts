import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { BusinessTenantGuard } from '../../common/guards/business-tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ChatbotFlowsService } from './chatbot-flows.service';
import { CreateChatbotFlowDto } from './dto/create-chatbot-flow.dto';
import { UpdateChatbotFlowDto } from './dto/update-chatbot-flow.dto';
import type { FlujoChatbot } from './chatbot.nodes';

/**
 * Solo administradores: un flujo de chatbot habla con clientes en nombre de
 * la empresa, igual que una automatizacion.
 */
@UseGuards(AuthGuard('jwt'), BusinessTenantGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@Controller('chatbot/flows')
export class ChatbotController {
  constructor(private readonly flows: ChatbotFlowsService) {}

  /** Sesiones. Antes de `:id` para que la ruta literal gane. */
  @Get('sessions')
  sessions(
    @Request() req: any,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.flows.sessions(req.user.companyId, {
      status,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get()
  findAll(@Request() req: any) {
    return this.flows.findAll(req.user.companyId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.flows.findById(id, req.user.companyId);
  }

  @Post()
  create(@Request() req: any, @Body() body: CreateChatbotFlowDto) {
    return this.flows.create(req.user.companyId, {
      name: body.name,
      draftNodes: body.draftNodes as unknown as FlujoChatbot,
      triggerKeywords: body.triggerKeywords,
    });
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: UpdateChatbotFlowDto,
  ) {
    return this.flows.updateDraft(id, req.user.companyId, {
      name: body.name,
      draftNodes: body.draftNodes as unknown as FlujoChatbot,
      triggerKeywords: body.triggerKeywords,
      isActive: body.isActive,
    });
  }

  @Post(':id/publish')
  publish(@Param('id') id: string, @Request() req: any) {
    return this.flows.publish(id, req.user.companyId, req.user.sub);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: any) {
    return this.flows.remove(id, req.user.companyId);
  }
}
