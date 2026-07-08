import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { BusinessTenantGuard } from '../../common/guards/business-tenant.guard';
import { NotesService } from './notes.service';
import { CreateNoteDto } from './dto/create-note.dto';

@UseGuards(AuthGuard('jwt'), BusinessTenantGuard)
@Controller('notes')
export class NotesController {
  constructor(private notesService: NotesService) {}

  @Get()
  findAll(
    @Request() req: any,
    @Query('leadId') leadId?: string,
    @Query('conversationId') conversationId?: string,
  ) {
    if (leadId) return this.notesService.findByLead(leadId, req.user.companyId);
    if (conversationId)
      return this.notesService.findByConversation(
        conversationId,
        req.user.companyId,
      );
    throw new BadRequestException('Debe especificar leadId o conversationId');
  }

  @Post()
  create(@Request() req: any, @Body() body: CreateNoteDto) {
    return this.notesService.create(req.user.companyId, req.user.sub, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: any) {
    return this.notesService.remove(id, req.user.companyId);
  }
}
