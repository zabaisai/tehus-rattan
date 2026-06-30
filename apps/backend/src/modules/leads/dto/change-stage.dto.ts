import { IsString, IsNotEmpty } from 'class-validator';

export class ChangeStageDto {
  @IsString()
  @IsNotEmpty({ message: 'La etapa destino es requerida' })
  stageId!: string;
}
