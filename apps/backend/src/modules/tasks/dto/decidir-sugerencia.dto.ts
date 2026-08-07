import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { TaskPriority } from '@prisma/client';

/**
 * Lo que el bot propone es un BORRADOR, no una orden: quien aprueba puede
 * corregir el titulo, la prioridad, el vencimiento y a quien se asigna antes
 * de aceptarla. Todo opcional; lo que no venga se toma de la propuesta.
 */
export class AprobarSugerenciaDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsISO8601()
  dueAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  assignedTo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RechazarSugerenciaDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
