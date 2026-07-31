import { IsString, MaxLength, MinLength } from 'class-validator';

export class RequestDeletionDto {
  /**
   * Obligatorio y con longitud minima: una solicitud de eliminacion sin
   * motivo no se puede revisar ni defender despues.
   */
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}
