import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

/** Los tipos que la búsqueda global sabe recorrer. */
export const TIPOS_BUSCABLES = [
  'contactos',
  'conversaciones',
  'oportunidades',
  'productos',
  'cotizaciones',
] as const;

export type TipoBuscable = (typeof TIPOS_BUSCABLES)[number];

/**
 * Longitud mínima de la consulta.
 *
 * Con una sola letra la búsqueda deja de discriminar: devuelve media empresa y
 * obliga a la base a recorrer cinco tablas para nada. Dos caracteres es el
 * mínimo con el que el resultado significa algo.
 */
export const LONGITUD_MINIMA_CONSULTA = 2;

/** Tope por tipo. Es una paleta, no un listado: caben pocos y bien elegidos. */
export const LIMITE_POR_TIPO_POR_DEFECTO = 5;
export const LIMITE_POR_TIPO_MAXIMO = 20;

export class SearchQueryDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(LONGITUD_MINIMA_CONSULTA, {
    message: `La búsqueda necesita al menos ${LONGITUD_MINIMA_CONSULTA} caracteres`,
  })
  q!: string;

  /**
   * Tipos a consultar. Ausente = todos.
   *
   * Se acepta `tipos=a,b` y `tipos=a&tipos=b`: la primera forma es la que
   * produce una URL legible y la segunda la que arma un cliente HTTP sin
   * pensarlo.
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    const lista = Array.isArray(value) ? value : String(value).split(',');
    return lista.map((v) => String(v).trim()).filter(Boolean);
  })
  @IsArray()
  @IsIn(TIPOS_BUSCABLES, { each: true })
  tipos?: TipoBuscable[];

  /** Incluye contactos archivados (la papelera). Por defecto NO. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  incluirPapelera?: boolean;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(LIMITE_POR_TIPO_MAXIMO)
  limite?: number;
}
