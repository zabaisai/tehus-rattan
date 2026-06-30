import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConversationsService } from './conversations.service';
import { MessagesService } from '../messages/messages.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { SendMessageDto } from './dto/send-message.dto';

@UseGuards(AuthGuard('jwt'))
@Controller('conversations')
export class ConversationsController {
  constructor(
    private conversationsService: ConversationsService,
    private messagesService: MessagesService,
    private whatsappService: WhatsappService,
  ) {}

  @Get()
  findAll(@Request() req: any) {
    return this.conversationsService.findAll(req.user.companyId);
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
  createMessage(@Param('id') id: string, @Body() body: CreateMessageDto) {
    return this.messagesService.create({
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

    await this.whatsappService.sendMessage(
      conversation.contact.phone,
      body.message,
    );

    return this.messagesService.create({
      conversationId: id,
      body: body.message,
      direction: 'OUTBOUND',
      type: 'TEXT',
      status: 'SENT',
    });
  }
}
