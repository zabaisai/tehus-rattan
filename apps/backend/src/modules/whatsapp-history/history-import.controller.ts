import {
  Body,
  Controller,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { BusinessTenantGuard } from '../../common/guards/business-tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { HistoryImportService } from './history-import.service';
import { ImportHistoryDto } from './dto/import-history.dto';

/**
 * Importacion de historial. Solo ADMIN: mete conversaciones en el hilo de
 * clientes reales y no se deshace con un boton.
 */
@UseGuards(AuthGuard('jwt'), BusinessTenantGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@Controller('whatsapp/history')
export class HistoryImportController {
  constructor(private readonly importacion: HistoryImportService) {}

  /** Analiza el CSV sin importar: que se veria si se importara. */
  @Post('preview')
  preview(@Body() body: ImportHistoryDto) {
    const { filas, rechazados } = this.importacion.analizar(body.csv);
    return {
      filasValidas: filas.length,
      rechazados,
      // Muestra las primeras para que se pueda comprobar el formato de fecha
      // y la direccion antes de meter miles.
      muestra: filas.slice(0, 5),
    };
  }

  @Post('import')
  importar(@Request() req: any, @Body() body: ImportHistoryDto) {
    return this.importacion.importar(req.user.companyId, body.csv);
  }
}
