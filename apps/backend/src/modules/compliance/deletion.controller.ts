import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PlatformGuard } from '../../common/guards/platform.guard';
import { DeletionService } from './deletion.service';
import { ExecuteDeletionDto } from './dto/execute-deletion.dto';
import { RejectDeletionDto } from './dto/reject-deletion.dto';

/**
 * Aprobacion y ejecucion de eliminaciones. SOLO plataforma.
 *
 * Un ADMIN puede PEDIR la eliminacion de su empresa -eso vive en
 * `compliance.controller.ts`- pero no consumarla. Si pudiera, un ADMIN
 * comprometido borraria el historial de su propia empresa sin que nadie mas
 * interviniera.
 */
@UseGuards(AuthGuard('jwt'), PlatformGuard)
@Controller('platform/deletion-requests')
export class DeletionController {
  constructor(private readonly deletion: DeletionService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.deletion.listAll(status);
  }

  /** Que se borraria. Quien ejecuta debe ver el numero antes de teclear. */
  @Get(':id/preview')
  preview(@Param('id') id: string) {
    return this.deletion.preview(id);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @Request() req: any) {
    return this.deletion.approve(id, {
      userId: req.user.sub,
      role: req.user.role,
    });
  }

  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: RejectDeletionDto,
  ) {
    return this.deletion.reject(id, body.reason, {
      userId: req.user.sub,
      role: req.user.role,
    });
  }

  /** Punto sin retorno. Exige el nombre exacto de la empresa. */
  @Post(':id/execute')
  execute(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: ExecuteDeletionDto,
  ) {
    return this.deletion.execute(id, body.confirmation, {
      userId: req.user.sub,
      role: req.user.role,
    });
  }
}
