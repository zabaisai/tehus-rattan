import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RenameNumberDto {
  /** `null` o vacío borra la etiqueta y deja el número visible a secas. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  label?: string | null;
}
