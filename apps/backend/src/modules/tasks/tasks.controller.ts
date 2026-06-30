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
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@UseGuards(AuthGuard('jwt'))
@Controller('tasks')
export class TasksController {
  constructor(private tasksService: TasksService) {}

  @Get()
  findAll(
    @Request() req: any,
    @Query('leadId') leadId?: string,
    @Query('contactId') contactId?: string,
    @Query('status') status?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('overdue') overdue?: string,
  ) {
    return this.tasksService.findAll(req.user.companyId, {
      leadId,
      contactId,
      status,
      assignedTo,
      overdue: overdue === 'true',
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.tasksService.findById(id, req.user.companyId);
  }

  @Post()
  create(@Request() req: any, @Body() body: CreateTaskDto) {
    return this.tasksService.create(req.user.companyId, body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: UpdateTaskDto,
  ) {
    return this.tasksService.update(id, req.user.companyId, body);
  }

  @Patch(':id/complete')
  complete(@Param('id') id: string, @Request() req: any) {
    return this.tasksService.complete(id, req.user.companyId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: any) {
    return this.tasksService.remove(id, req.user.companyId);
  }
}
