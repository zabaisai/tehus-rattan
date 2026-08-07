import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Destino explicito: embudo Y etapa.
 *
 * No hay valor por defecto a proposito. «Lo mando al primer embudo que
 * encuentre» reparte el trabajo de un equipo por una etapa que nadie eligio, y
 * peor: buscarlo por nombre —«Cotizaciones», «Nuevo»— rompe en cuanto alguien
 * renombra su embudo, que es algo que puede hacer cualquier dia.
 */
export class TrasladarOportunidadesDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  pipelineDestinoId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  etapaDestinoId!: string;
}
