import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class EliminarContactoDto {
  /**
   * La frase exacta, escrita a mano. Un `confirm()` se pulsa sin leerlo;
   * teclear once caracteres obliga a mirar lo que se esta a punto de hacer.
   * El texto que se espera lo dicta el servicio, no este DTO: aqui solo se
   * comprueba que venga algo con forma de frase.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  confirmacion!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}
