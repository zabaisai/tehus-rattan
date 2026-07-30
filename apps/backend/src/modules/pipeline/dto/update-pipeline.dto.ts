import { IsString, IsOptional, IsBoolean, IsInt, Min } from 'class-validator';

export class UpdatePipelineDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  // Archivar retira el pipeline de la operación sin borrarlo. El servicio
  // impide archivar el predeterminado.
  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}
