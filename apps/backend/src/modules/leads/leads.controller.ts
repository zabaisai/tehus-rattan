import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { BusinessTenantGuard } from '../../common/guards/business-tenant.guard';
import { LeadsService } from './leads.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { ChangeStageDto } from './dto/change-stage.dto';
import { ChangeStatusDto } from './dto/change-status.dto';

@UseGuards(AuthGuard('jwt'), BusinessTenantGuard)
@Controller('leads')
export class LeadsController {
  constructor(private leadsService: LeadsService) {}

  @Get()
  findAll(
    @Request() req: any,
    @Query('pipelineId') pipelineId?: string,
    @Query('stageId') stageId?: string,
    @Query('contactId') contactId?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.leadsService.findAll(req.user.companyId, {
      pipelineId,
      stageId,
      contactId,
      assignedTo,
      status,
      search,
      limit,
      offset,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.leadsService.findById(id, req.user.companyId);
  }

  @Get(':id/history')
  getHistory(@Param('id') id: string, @Request() req: any) {
    return this.leadsService.getHistory(id, req.user.companyId);
  }

  @Post()
  create(@Request() req: any, @Body() body: CreateLeadDto) {
    return this.leadsService.create(req.user.companyId, body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: UpdateLeadDto,
  ) {
    return this.leadsService.update(id, req.user.companyId, body);
  }

  @Patch(':id/stage')
  changeStage(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: ChangeStageDto,
  ) {
    return this.leadsService.changeStage(
      id,
      req.user.companyId,
      body.stageId,
      req.user.sub,
    );
  }

  @Patch(':id/status')
  changeStatus(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: ChangeStatusDto,
  ) {
    return this.leadsService.changeStatus(
      id,
      req.user.companyId,
      body.status,
      body.lostReason,
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: any) {
    return this.leadsService.remove(id, req.user.companyId);
  }
}
