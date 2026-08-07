import {
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO de la API administrativa.
 *
 * NINGUNO LLEVA `companyId`. No es un olvido: si estuviera, alguien acabaría
 * confiando en él, y mandar el de otra empresa sería todo lo que haría falta
 * para administrar sus bots. La empresa sale del token y solo del token.
 *
 * Los grafos van como `unknown` a propósito: validarlos con `class-validator`
 * duplicaría el validador de grafos, que es mucho más estricto y ya existe. El
 * DTO comprueba que hay algo; el validador comprueba que sirve.
 */

export class CrearBotDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  nombre!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  descripcion?: string;

  /** Opcional: sin él se crea un grafo inicial con su disparador. */
  @IsOptional()
  @IsObject()
  graph?: unknown;
}

export class RenombrarBotDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  nombre!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  descripcion?: string;
}

export class GuardarBorradorDto {
  @IsObject()
  graph!: unknown;

  /**
   * La revisión que el cliente tenía cuando empezó a editar.
   *
   * OBLIGATORIA. Sin ella no hay control optimista, y el último en guardar
   * borraría el trabajo del anterior sin que ninguno de los dos se enterara.
   */
  @IsInt()
  @Min(0)
  revision!: number;
}

export class PublicarDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  nota?: string;
}

export class CrearDisparadorDto {
  @IsString()
  tipo!: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsInt()
  prioridad?: number;

  @IsOptional()
  @IsBoolean()
  exclusivo?: boolean;

  @IsOptional()
  @IsObject()
  filtros?: unknown;

  @IsOptional()
  @IsString()
  whatsappIntegrationId?: string;

  @IsOptional()
  @IsString()
  scheduleSpec?: string;
}

export class ActualizarDisparadorDto {
  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsInt()
  prioridad?: number;

  @IsOptional()
  @IsBoolean()
  exclusivo?: boolean;

  @IsOptional()
  @IsObject()
  filtros?: unknown;

  @IsOptional()
  @IsString()
  whatsappIntegrationId?: string | null;

  @IsOptional()
  @IsString()
  scheduleSpec?: string | null;
}

class OrdenDisparadorDto {
  @IsString()
  triggerId!: string;

  @IsInt()
  prioridad!: number;
}

export class OrdenarDisparadoresDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrdenDisparadorDto)
  orden!: OrdenDisparadorDto[];
}

export class OperacionEjecucionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  motivo?: string;
}

export class ForzarHandoffDto {
  @IsOptional()
  @IsString()
  asignarA?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  motivo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  nota?: string;
}

/**
 * Entrada del simulador.
 *
 * Casi todo es opcional porque simular tiene que ser barato: pegar un grafo y
 * pulsar debería funcionar. Los detalles —zona horaria, hora, fallos— existen
 * para responder «¿y si…?», no para poder empezar.
 */
export class EntradaSimulacionBodyDto {
  @IsObject()
  graph!: unknown;

  @IsOptional()
  @IsObject()
  contacto?: {
    nombre?: string;
    telefono?: string;
    email?: string;
    etiquetas?: string[];
    campos?: Record<string, string>;
  };

  @IsOptional()
  @IsObject()
  oportunidad?: { pipelineId?: string; stageId?: string; valor?: number };

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  mensajeInicial?: string;

  @IsOptional()
  @IsObject()
  variables?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  zonaHoraria?: string;

  @IsOptional()
  @IsString()
  ahora?: string;

  @IsOptional()
  @IsString()
  whatsappIntegrationId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  respuestas?: string[];

  @IsOptional()
  @IsObject()
  fallos?: { whatsapp?: boolean; http?: boolean; ia?: boolean };

  @IsOptional()
  @IsObject()
  respuestaIa?: { eleccion?: string; texto?: string; confianza?: number };

  @IsOptional()
  @IsObject()
  respuestaHttp?: { estado?: number; datos?: unknown };

  @IsOptional()
  @IsInt()
  @Min(0)
  avanzarRelojSegundos?: number;

  @IsOptional()
  @IsBoolean()
  forzarTimeout?: boolean;
}

/**
 * Un `.taktoflow.json` entrante.
 *
 * Llega como TEXTO y no como objeto a proposito: asi la validacion del formato
 * la hace el analizador, entera y en un solo sitio, en vez de repartirse entre
 * `class-validator` y el codigo. El tope de aqui es la primera barrera; el
 * analizador vuelve a comprobarlo.
 */
export class ImportarPulsoDto {
  @IsString()
  @MinLength(2)
  @MaxLength(2 * 1024 * 1024)
  contenido!: string;

  /** Nombre con el que guardarlo. Si no viene, se usa el del archivo. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nombre?: string;
}
