import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ContactsService } from './contacts.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';

@UseGuards(AuthGuard('jwt'))
@Controller('contacts')
export class ContactsController {
  constructor(private contactsService: ContactsService) {}

  @Get()
  findAll(@Request() req: any) {
    return this.contactsService.findAll(req.user.companyId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.contactsService.findById(id, req.user.companyId);
  }

  @Post()
  create(@Request() req: any, @Body() body: CreateContactDto) {
    return this.contactsService.create(req.user.companyId, body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: UpdateContactDto,
  ) {
    return this.contactsService.update(id, req.user.companyId, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: any) {
    return this.contactsService.remove(id, req.user.companyId);
  }

  @Post(':id/block')
  block(@Param('id') id: string, @Request() req: any) {
    return this.contactsService.block(id, req.user.companyId);
  }
}
