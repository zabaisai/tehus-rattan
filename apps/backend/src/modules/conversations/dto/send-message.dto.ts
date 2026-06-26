import { IsString, IsNotEmpty } from 'class-validator';

export class SendMessageDto {
  @IsString()
  @IsNotEmpty({ message: 'El mensaje es requerido' })
  message!: string;
}
