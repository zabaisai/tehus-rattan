import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Res,
  Query,
  Request,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { RolesGuard } from '../../common/guards/roles.guard';
import { BusinessTenantGuard } from '../../common/guards/business-tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ProductsService } from './products.service';
import { ProductImportFileSizeFilter } from './product-import-file-size.filter';
import {
  MAX_PRODUCT_IMPORT_FILE_SIZE_BYTES,
  MAX_PRODUCT_IMPORT_FILE_SIZE_MB,
  MAX_PRODUCT_IMPORT_ROWS,
} from './products-import.constants';
import type { Response } from 'express';
import { unlink } from 'fs/promises';
import { ImportacionDeProductosService } from './import/importacion.service';
import { ImportacionQueue } from './import/importacion.queue';
import {
  almacenamientoEnDisco,
  comprobarEspacio,
} from './import/almacenamiento-temporal';
import { validarMapeo } from './import/mapeo-columnas';
import {
  EXTENSIONES_PERMITIDAS,
  validarArchivoDeImportacion,
} from './import/validacion-archivo';
import { FijarMapeoDto, SubirImportacionDto } from './import/dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@UseGuards(AuthGuard('jwt'), BusinessTenantGuard, RolesGuard)
@Controller('products')
export class ProductsController {
  constructor(
    private productsService: ProductsService,
    private importaciones: ImportacionDeProductosService,
    private cola: ImportacionQueue,
  ) {}

  @Get()
  findAll(
    @Request() req: any,
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.productsService.findAll(req.user.companyId, {
      category,
      search,
      limit,
      offset,
    });
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post()
  create(@Request() req: any, @Body() body: CreateProductDto) {
    return this.productsService.create(req.user.companyId, body);
  }

  /**
   * SUBE el archivo y registra la importacion. NO la procesa.
   *
   * El archivo va A DISCO, no a memoria: un catalogo grande en RAM son cientos
   * de megas antes de que nadie lo mire. Y el procesamiento va a la cola,
   * porque tarda minutos y hacerlo dentro de la peticion significa que el
   * navegador espera hasta que el proxy corta la conexion.
   */
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post('import')
  @UseFilters(ProductImportFileSizeFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: almacenamientoEnDisco,
      limits: { fileSize: MAX_PRODUCT_IMPORT_FILE_SIZE_BYTES },
    }),
  )
  async subirImportacion(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Request() req: any,
    @Body() body: SubirImportacionDto,
  ) {
    if (!file) throw new BadRequestException('El archivo es requerido');

    try {
      validarArchivoDeImportacion(file.originalname, file.size);
      await comprobarEspacio(file.size);
    } catch (error) {
      // El archivo ya esta en disco: si se rechaza, hay que borrarlo o queda
      // ocupando sitio para siempre.
      await unlink(file.path).catch(() => undefined);
      throw error;
    }

    const importacion = await this.importaciones.registrar(
      req.user.companyId,
      req.user.sub,
      { nombre: file.originalname, tamaño: file.size, rutaTemporal: file.path },
      body?.idempotencyKey,
    );

    return {
      ...importacion,
      // Quien sube decide si empieza ya o revisa antes el mapeo de columnas.
      siguientePaso: 'Revisa la vista previa y confirma el mapeo de columnas.',
    };
  }

  /**
   * Los limites REALES de la importacion, tal como los aplica este servidor.
   *
   * La interfaz los tenia escritos a mano —50 MB y 10.000 filas— y ya no
   * coincidian con lo que el backend acepta. Un limite duplicado a mano
   * SIEMPRE acaba desviandose, y entonces la pantalla promete una cosa y el
   * servidor hace otra.
   *
   * `subidaMaximaReal` puede ser MENOR que el limite del producto: el proxy de
   * delante tiene su propio tope de cuerpo de peticion, y de nada sirve
   * ofrecer 500 MB si la subida muere antes de llegar aqui.
   */
  @Get('import/limits')
  limitesDeImportacion() {
    const topeProxyMb = Number(process.env.PROXY_MAX_BODY_MB) || null;
    return {
      formatos: EXTENSIONES_PERMITIDAS,
      tamañoMaximoMb: MAX_PRODUCT_IMPORT_FILE_SIZE_MB,
      filasMaximas: MAX_PRODUCT_IMPORT_ROWS,
      // El menor de los dos manda: es el que de verdad puede subir alguien.
      subidaMaximaMb: topeProxyMb
        ? Math.min(topeProxyMb, MAX_PRODUCT_IMPORT_FILE_SIZE_MB)
        : MAX_PRODUCT_IMPORT_FILE_SIZE_MB,
      limitadoPorElProxy:
        !!topeProxyMb && topeProxyMb < MAX_PRODUCT_IMPORT_FILE_SIZE_MB,
    };
  }

  /** Cabeceras, mapeo propuesto y unas filas. NO escribe nada. */
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Get('import/:id/preview')
  vistaPrevia(@Param('id') id: string, @Request() req: any) {
    return this.importaciones.vistaPrevia(id, req.user.companyId);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post('import/:id/mapping')
  async fijarMapeo(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: FijarMapeoDto,
  ) {
    const previa = await this.importaciones.vistaPrevia(
      id,
      req.user.companyId,
      1,
    );
    const error = validarMapeo(body.mapeo, previa.cabeceras.length);
    if (error) throw new BadRequestException(error);
    return this.importaciones.fijarMapeo(id, req.user.companyId, body.mapeo);
  }

  /** Arranca el procesamiento. */
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post('import/:id/start')
  async arrancar(@Param('id') id: string, @Request() req: any) {
    const imp = await this.importaciones.estado(id, req.user.companyId);
    if (imp.status !== 'PENDING') {
      throw new BadRequestException('Esta importación ya arrancó.');
    }

    const encolada = await this.cola.encolar({
      importId: id,
      companyId: req.user.companyId,
    });

    if (!encolada) {
      // Sin cola se procesa EN LINEA. Es mas lento y ata la peticion, pero es
      // mejor que aceptar un archivo y no procesarlo nunca; el estado durable
      // hace que el progreso se vea igual.
      void this.importaciones.procesar(id);
    }

    return { encolada, importId: id };
  }

  /** Progreso. Es lo que consulta la pantalla mientras corre. */
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Get('import/:id')
  estadoDeImportacion(@Param('id') id: string, @Request() req: any) {
    return this.importaciones.estado(id, req.user.companyId);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Get('import')
  historialDeImportaciones(@Request() req: any) {
    return this.importaciones.listar(req.user.companyId);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post('import/:id/cancel')
  cancelarImportacion(@Param('id') id: string, @Request() req: any) {
    return this.importaciones.cancelar(id, req.user.companyId);
  }

  /**
   * Reporte descargable de lo que fallo.
   *
   * CSV y no JSON porque quien lo necesita lo va a abrir en Excel para
   * arreglar su catalogo, no a leerlo en una consola.
   */
  @Roles('ADMIN', 'SUPER_ADMIN')
  @Get('import/:id/report')
  async reporte(
    @Param('id') id: string,
    @Request() req: any,
    @Res() res: Response,
  ) {
    const imp = await this.importaciones.estado(id, req.user.companyId);
    const incidencias = Array.isArray(imp.issues)
      ? (imp.issues as Array<{ fila: number; motivo: string; nombre?: string }>)
      : [];

    const lineas = [
      'fila,motivo,nombre',
      ...incidencias.map(
        (i) =>
          `${i.fila},"${(i.motivo ?? '').replace(/"/g, '""')}","${(i.nombre ?? '').replace(/"/g, '""')}"`,
      ),
    ];

    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="importacion-${id}.csv"`,
      'Cache-Control': 'no-store',
    });
    // BOM para que Excel abra los acentos bien en vez de en mojibake.
    res.send('﻿' + lineas.join('\n'));
  }

  /**
   * VA DESPUES de todas las rutas de `import`.
   *
   * En Nest las rutas se prueban en orden de declaracion, y `:id` casa con un
   * segmento cualquiera: declarado antes, `GET /products/import` habria caido
   * aqui buscando un producto con id «import» y devolviendo 404 en vez del
   * historial de importaciones.
   */
  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.productsService.findById(id, req.user.companyId);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Request() req: any,
    @Body() body: UpdateProductDto,
  ) {
    return this.productsService.update(id, req.user.companyId, body);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: any) {
    return this.productsService.remove(id, req.user.companyId);
  }
}
