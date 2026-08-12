import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { BusinessTenantGuard } from '../../common/guards/business-tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SearchQueryDto } from './dto/search-query.dto';
import { SearchService } from './search.service';

/**
 * Búsqueda global de la empresa.
 *
 * Mismos guardas que el resto de listados de negocio. NO lleva `@Roles`: cada
 * listado que consulta (`GET /contacts`, `/conversations`, `/leads`,
 * `/products`, `/quotes`) es legible por cualquier usuario de la empresa, así
 * que restringir aquí escondería resultados que el usuario ya puede ver
 * entrando a la pantalla — y sugeriría una protección que no existe.
 *
 * `BusinessTenantGuard` exige que el token traiga empresa, así que un
 * SUPER_ADMIN de plataforma sin empresa no puede usar este endpoint: no hay
 * «buscar en todas», que es justo lo que no debe existir.
 */
@UseGuards(AuthGuard('jwt'), BusinessTenantGuard, RolesGuard)
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  buscar(@Query() query: SearchQueryDto, @Request() req: any) {
    // La empresa sale del token. El DTO no tiene `companyId` a propósito:
    // aceptarlo del cliente sería el camino más corto para leer otra empresa.
    return this.searchService.buscar(req.user.companyId, {
      q: query.q,
      tipos: query.tipos,
      incluirPapelera: query.incluirPapelera,
      limite: query.limite,
    });
  }
}
