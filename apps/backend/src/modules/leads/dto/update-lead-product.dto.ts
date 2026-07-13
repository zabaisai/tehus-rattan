import { IsString, IsOptional, IsInt, IsNumber, Min } from 'class-validator';

export class UpdateLeadProductDto {
  @IsOptional()
  @IsInt({ message: 'La cantidad debe ser un número entero' })
  @Min(1, { message: 'La cantidad mínima es 1' })
  quantity?: number;

  @IsOptional()
  @IsNumber({}, { message: 'El precio unitario debe ser un número' })
  @Min(0, { message: 'El precio unitario no puede ser negativo' })
  unitPrice?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
