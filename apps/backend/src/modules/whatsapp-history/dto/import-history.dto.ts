import { IsString, MaxLength, MinLength } from 'class-validator';

export class ImportHistoryDto {
  /**
   * Contenido del CSV. `companyId` NO aparece: sale del token, o se podria
   * importar historial en el hilo de otra empresa.
   */
  @IsString()
  @MinLength(10)
  // ~8 MB: por encima, el fichero se parte. El limite del body parser es 1 MB
  // por defecto, asi que en la practica corta antes; esto es la red de
  // seguridad si alguien lo sube.
  @MaxLength(8_000_000)
  csv!: string;
}
