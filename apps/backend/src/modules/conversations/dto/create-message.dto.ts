import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';

export class CreateMessageDto {
  @IsString()
  @IsNotEmpty({ message: 'El contenido del mensaje es requerido' })
  body!: string;

  @IsOptional()
  @IsString()
  @IsIn(['TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT'], {
    message: 'Tipo no válido',
  })
  type?: string;
}
