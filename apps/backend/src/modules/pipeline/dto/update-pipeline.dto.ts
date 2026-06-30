import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class UpdatePipelineDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
