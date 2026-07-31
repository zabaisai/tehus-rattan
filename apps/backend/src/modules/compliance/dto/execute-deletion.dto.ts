import { IsString, MaxLength, MinLength } from 'class-validator';

export class ExecuteDeletionDto {
  /**
   * Nombre EXACTO de la empresa, escrito a mano. Un boton de confirmacion se
   * pulsa por inercia; teclear el nombre completo, no.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  confirmation!: string;
}
