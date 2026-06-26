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
import { AutomationsService } from './automations.service';

@UseGuards(AuthGuard('jwt'))
@Controller('automations')
export class AutomationsController {
  constructor(private automationsService: AutomationsService) {}

  @Get()
  findAll(@Request() req: any) {
    return this.automationsService.findAll(req.user.companyId);
  }

  @Post()
  create(
    @Request() req: any,
    @Body()
    body: {
      name: string;
      trigger: string;
      conditions?: any;
      actions: any;
      order?: number;
    },
  ) {
    return this.automationsService.create(req.user.companyId, body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      isActive?: boolean;
      trigger?: string;
      conditions?: any;
      actions?: any;
      order?: number;
    },
  ) {
    return this.automationsService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.automationsService.remove(id);
  }
}
