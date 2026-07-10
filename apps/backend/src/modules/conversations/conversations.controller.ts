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

@UseGuards(AuthGuard('jwt'), BusinessTenantGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(
    private conversationsService: ConversationsService,
    private messagesService: MessagesService,
    private whatsappService: WhatsappService,
  ) {}

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
