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
import { PipelineService } from './pipeline.service';
import { CreatePipelineDto } from './dto/create-pipeline.dto';
import { UpdatePipelineDto } from './dto/update-pipeline.dto';
import { CreateStageDto } from './dto/create-stage.dto';
import { UpdateStageDto } from './dto/update-stage.dto';
import { ReorderStagesDto } from './dto/reorder-stages.dto';

@UseGuards(AuthGuard('jwt'))
@Controller('pipelines')
export class PipelineController {
  constructor(private pipelineService: PipelineService) {}

  @Get()
  findAll(@Request() req: any) {
    return this.pipelineService.findAll(req.user.companyId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.pipelineService.findById(id, req.user.companyId);
  }

  @Post()
  create(@Request() req: any, @Body() body: CreatePipelineDto) {
    return this.pipelineService.create(req.user.companyId, body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: UpdatePipelineDto,
  ) {
    return this.pipelineService.update(id, req.user.companyId, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: any) {
    return this.pipelineService.remove(id, req.user.companyId);
  }

  // ───────────────────────────────────────────
  // ETAPAS
  // ───────────────────────────────────────────

  @Get(':id/stages')
  findStages(@Param('id') id: string, @Request() req: any) {
    return this.pipelineService.findStages(id, req.user.companyId);
  }

  @Post(':id/stages')
  createStage(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: CreateStageDto,
  ) {
    return this.pipelineService.createStage(id, req.user.companyId, body);
  }

  @Patch(':id/stages/:stageId')
  updateStage(
    @Param('id') id: string,
    @Param('stageId') stageId: string,
    @Request() req: any,
    @Body() body: UpdateStageDto,
  ) {
    return this.pipelineService.updateStage(
      id,
      stageId,
      req.user.companyId,
      body,
    );
  }

  @Delete(':id/stages/:stageId')
  removeStage(
    @Param('id') id: string,
    @Param('stageId') stageId: string,
    @Request() req: any,
  ) {
    return this.pipelineService.removeStage(id, stageId, req.user.companyId);
  }

  @Patch(':id/stages/reorder')
  reorderStages(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: ReorderStagesDto,
  ) {
    return this.pipelineService.reorderStages(
      id,
      req.user.companyId,
      body.stages,
    );
  }
}
