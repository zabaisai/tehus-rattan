import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';

export class CreatePipelineDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre del pipeline es requerido' })
  name!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
