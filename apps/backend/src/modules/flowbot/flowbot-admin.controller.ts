import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PlatformGuard } from '../../common/guards/platform.guard';
import {
  FlowBotReconcilerService,
  InformeReconciliacion,
} from './engine/flowbot.reconciler';

/**
 * Operación del motor de FlowBot.
 *
 * PROTEGIDO POR `PlatformGuard`, que exige SUPER_ADMIN sin empresa. No es un
 * endpoint de cliente: forzar una reconciliación toca ejecuciones de TODAS las
 * empresas, y ninguna debería poder disparar trabajo sobre las demás.
 *
 * Existe porque esperar al intervalo de un minuto durante un incidente es
 * eterno, y porque poder ver el último informe sin entrar a la base es la
 * diferencia entre diagnosticar en un minuto o en veinte.
 */
@UseGuards(AuthGuard('jwt'), PlatformGuard)
@Controller('platform/flowbot')
export class FlowBotAdminController {
  constructor(private readonly reconciler: FlowBotReconcilerService) {}

  /** Último informe y contadores. No dispara nada. */
  @Get('reconciler')
  estado() {
    return this.reconciler.estado();
  }

  /**
   * Fuerza un pase.
   *
   * Es seguro llamarlo a mano y repetidamente: el pase es idempotente y está
   * acotado, y si ya hay uno en curso el servicio lo salta. Lo peor que puede
   * pasar es que devuelva un informe con todo a cero.
   */
  @Post('reconciler/run')
  async ejecutar(): Promise<InformeReconciliacion> {
    return this.reconciler.reconciliar();
  }
}
