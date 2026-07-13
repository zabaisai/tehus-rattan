import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
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
import { ProductsImportService } from './products-import.service';
import { ProductImportFileSizeFilter } from './product-import-file-size.filter';
import { MAX_PRODUCT_IMPORT_FILE_SIZE_BYTES } from './products-import.constants';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@UseGuards(AuthGuard('jwt'), BusinessTenantGuard, RolesGuard)
@Controller('products')
export class ProductsController {
  constructor(
    private productsService: ProductsService,
    private productsImportService: ProductsImportService,
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

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.productsService.findById(id, req.user.companyId);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post()
  create(@Request() req: any, @Body() body: CreateProductDto) {
    return this.productsService.create(req.user.companyId, body);
  }

  @Roles('ADMIN', 'SUPER_ADMIN')
  @Post('import')
  @UseFilters(ProductImportFileSizeFilter)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_PRODUCT_IMPORT_FILE_SIZE_BYTES } }),
  )
  importExcel(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Request() req: any,
  ) {
    if (!file) {
      throw new BadRequestException('El archivo es requerido');
    }
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    return this.productsImportService.importFromExcel(
      req.user.companyId,
      file,
      baseUrl,
    );
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
