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

@UseGuards(AuthGuard('jwt'))
@Controller('conversations')
export class ConversationsController {
  constructor(
    private conversationsService: ConversationsService,
    private messagesService: MessagesService,
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
    @Body() body: { status?: string; stage?: string; assignedTo?: string },
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
  getMessages(@Param('id') id: string) {
    return this.messagesService.findByConversation(id);
  }

  @Post(':id/messages')
  createMessage(
    @Param('id') id: string,
    @Body() body: { body: string; type?: string },
  ) {
    return this.messagesService.create({
      conversationId: id,
      body: body.body,
      direction: 'OUTBOUND',
      type: body.type || 'TEXT',
    });
  }
}
