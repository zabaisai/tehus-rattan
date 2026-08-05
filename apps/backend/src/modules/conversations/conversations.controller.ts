import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { BusinessTenantGuard } from '../../common/guards/business-tenant.guard';
import { ConversationsService } from './conversations.service';
import { MessagesService } from '../messages/messages.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { BulkConversationsDto } from './dto/bulk-conversations.dto';
import { InboxService } from './inbox.service';
import { HandoffService } from './handoff.service';

@UseGuards(AuthGuard('jwt'), BusinessTenantGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(
    private conversationsService: ConversationsService,
    private messagesService: MessagesService,
    private whatsappService: WhatsappService,
    private inbox: InboxService,
    private handoff: HandoffService,
  ) {}

  /**
   * Bandeja con filtros. Va en una ruta aparte de `GET /conversations` para
   * no romper a quien ya consume aquella: devuelve otra forma -paginada y con
   * contador de no leidos- y mezclarlas obligaria a adivinar cual toca.
   */
  @Get('inbox')
  inboxList(
    @Request() req: any,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('assigned') assigned?: string,
    @Query('unread') unread?: string,
    @Query('withLead') withLead?: string,
    @Query('channel') channel?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.inbox.list(req.user.companyId, req.user.sub, {
      search,
      status,
      assigned,
      unread: unread === 'true',
      withLead:
        withLead === 'true' ? true : withLead === 'false' ? false : undefined,
      channel,
      limit,
      offset,
    });
  }

  /** Contadores de la cabecera de la bandeja. */
  @Get('inbox/counters')
  inboxCounters(@Request() req: any) {
    return this.inbox.counters(req.user.companyId, req.user.sub);
  }

  @Post('bulk')
  bulk(@Request() req: any, @Body() body: BulkConversationsDto) {
    return this.inbox.bulk(
      req.user.companyId,
      req.user.sub,
      body.conversationIds,
      {
        type: body.type,
        assignedTo: body.assignedTo,
        status: body.status,
      } as never,
    );
  }

  @Post(':id/read')
  markRead(@Param('id') id: string, @Request() req: any) {
    return this.inbox.markRead(id, req.user.companyId, req.user.sub);
  }

  @Post(':id/unread')
  markUnread(@Param('id') id: string, @Request() req: any) {
    return this.inbox.markUnread(id, req.user.companyId, req.user.sub);
  }

  @Get()
  findAll(
    @Request() req: any,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.conversationsService.findAll(req.user.companyId, {
      search,
      limit,
      offset,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.conversationsService.findById(id, req.user.companyId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: UpdateConversationDto,
  ) {
    return this.conversationsService.update(id, req.user.companyId, body);
  }

  @Post(':id/pause')
  pause(@Param('id') id: string, @Request() req: any) {
    return this.conversationsService.pause(id, req.user.companyId);
  }

  @Post(':id/resume')
  resume(@Param('id') id: string, @Request() req: any) {
    return this.conversationsService.resume(id, req.user.companyId);
  }

  // ── entrega a una persona ───────────────────────────────────
  //
  // Vive aqui y no en un controlador aparte porque es una operacion SOBRE la
  // conversacion: quien tiene permiso para verla tiene permiso para recogerla.

  /** La entrega activa, si la hay. Es lo que decide si el bot esta callado. */
  @Get(':id/handoff')
  handoffActivo(@Param('id') id: string, @Request() req: any) {
    return this.handoff.activa(req.user.companyId, id);
  }

  /**
   * Devuelve la conversacion al bot.
   *
   * `resumeBot` es una decision de quien resuelve, no del sistema: muchas
   * veces la conversacion TERMINA con la persona, y despertar al bot volveria
   * a escribirle al cliente sin motivo.
   */
  @Post(':id/handoff/resolve')
  resolverHandoff(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: { resumeBot?: boolean },
  ) {
    return this.handoff.resolver({
      companyId: req.user.companyId,
      conversationId: id,
      resolvedByUserId: req.user.sub,
      reanudarBot: body?.resumeBot === true,
    });
  }

  @Get(':id/messages')
  getMessages(@Param('id') id: string, @Request() req: any) {
    return this.messagesService.findByConversation(id, req.user.companyId);
  }

  @Post(':id/messages')
  createMessage(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: CreateMessageDto,
  ) {
    return this.messagesService.create({
      companyId: req.user.companyId,
      conversationId: id,
      body: body.body,
      direction: 'OUTBOUND',
      type: body.type || 'TEXT',
    });
  }

  @Post(':id/send')
  async sendWhatsApp(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: SendMessageDto,
  ) {
    const conversation = await this.conversationsService.findById(
      id,
      req.user.companyId,
    );

    try {
      const wamid = await this.whatsappService.sendMessage(
        req.user.companyId,
        conversation.contact.phone,
        body.message,
        // Se responde POR DONDE ENTRO. Con varios numeros, usar siempre el
        // principal hace que quien escribio a Soporte reciba la respuesta
        // desde Ventas: un numero que no reconoce. Si la conversacion no lo
        // sabe -es anterior a este campo, o vino de un CSV- se cae al
        // principal, que es el comportamiento de siempre.
        conversation.whatsappIntegration?.phoneNumberId,
      );

      return await this.messagesService.create({
        companyId: req.user.companyId,
        conversationId: id,
        body: body.message,
        direction: 'OUTBOUND',
        type: 'TEXT',
        status: 'SENT',
        wamid,
      });
    } catch {
      return this.messagesService.create({
        companyId: req.user.companyId,
        conversationId: id,
        body: body.message,
        direction: 'OUTBOUND',
        type: 'TEXT',
        status: 'FAILED',
      });
    }
  }
}
