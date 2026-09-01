import { IsOptional, IsString, MaxLength } from 'class-validator';

// Cuerpo opcional de DELETE /contacts/:id (archivar). Antes era un objeto inline
// `{ motivo?: string }` que el ValidationPipe global no validaba (metatype
// Object). Como DTO explícito, activa whitelist + rechazo de campos desconocidos.
export class ArchivarContactoDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}
