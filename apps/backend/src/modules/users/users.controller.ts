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
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  findAll(@Request() req: any) {
    return this.usersService.findAllByCompany(req.user.companyId);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post()
  create(@Request() req: any, @Body() body: CreateUserDto) {
    return this.usersService.create({ ...body, companyId: req.user.companyId });
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: UpdateUserDto,
  ) {
    return this.usersService.update(id, req.user.companyId, body);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Delete(':id')
  deactivate(@Param('id') id: string, @Request() req: any) {
    return this.usersService.deactivate(id, req.user.companyId);
  }
}
