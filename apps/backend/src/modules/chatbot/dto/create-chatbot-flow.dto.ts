import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * `companyId` NO aparece y no puede aparecer: sale del token. Aceptarlo
 * permitiria crear flujos en otra empresa enviando un campo de mas.
 */
export class CreateChatbotFlowDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  /** Definicion en edicion. Se valida al PUBLICAR, no aqui. */
  @IsOptional()
  @IsObject()
  draftNodes?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  triggerKeywords?: string[];
}
