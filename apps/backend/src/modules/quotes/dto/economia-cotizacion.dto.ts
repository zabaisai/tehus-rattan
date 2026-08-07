import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * LOS CAMPOS ECONOMICOS DE UNA COTIZACION, ALCANZABLES DESDE LA API.
 *
 * EL DEFECTO QUE ESTO ARREGLA
 *
 * El esquema, el motor de calculo y sus pruebas soportaban transporte,
 * impuesto, ajuste y descuentos por linea desde el primer dia. Los DTO no los
 * declaraban, y con `forbidNonWhitelisted` la API contestaba
 * «property shipping should not exist» a quien intentara usarlos. El frontend
 * tampoco los enviaba. Es decir: la funcionalidad existia, estaba probada y era
 * INALCANZABLE.
 *
 * No se detecto porque las pruebas ejercitan el servicio y el motor de calculo
 * directamente, nunca a traves de HTTP y su capa de validacion. Es el mismo
 * patron que escondio el `$ NaN` del tablero y el 500 del PDF: el fallo vive en
 * la frontera, no en el dominio.
 *
 * LIMITES
 *
 * Cada tope existe por una razon concreta, no por simetria:
 *
 * - `Min(0)` en descuento y transporte: un descuento negativo es un recargo
 *   encubierto y un transporte negativo no significa nada.
 * - `adjustment` SI admite negativo: es justamente su razon de ser —una rebaja
 *   pactada, un redondeo a la baja—. Es el unico campo que puede restar, y por
 *   eso el servidor comprueba ademas que el total no acabe por debajo de cero.
 * - `taxRate` entre 0 y 100: es un porcentaje. Un 1900 por un cero de mas
 *   multiplicaria el total por veinte sin que nada chille.
 * - Un techo de mil millones en los importes evita que un pegado accidental
 *   genere un documento absurdo, y mantiene los numeros lejos del limite de
 *   precision de `numeric(18,4)`.
 */
export const MAX_IMPORTE = 1_000_000_000;

/** Una línea de la cotización, identificada por su id ya persistido. */
export class LineaDeCotizacionDto {
  @IsString()
  id!: string;

  @IsOptional()
  @IsInt({ message: 'La cantidad debe ser un número entero' })
  @Min(1, { message: 'La cantidad mínima es 1' })
  @Max(1_000_000, { message: 'La cantidad es demasiado grande' })
  quantity?: number;

  @IsOptional()
  @IsNumber(
    { allowInfinity: false, allowNaN: false, maxDecimalPlaces: 4 },
    { message: 'El precio debe ser un número' },
  )
  @Min(0, { message: 'El precio no puede ser negativo' })
  @Max(MAX_IMPORTE, { message: 'El precio es demasiado grande' })
  unitPrice?: number;

  /**
   * Descuento de la línea, como IMPORTE.
   *
   * Se acota al bruto de la línea en el servidor: un descuento mayor que la
   * propia línea la pondría en negativo y arrastraría el subtotal.
   */
  @IsOptional()
  @IsNumber(
    { allowInfinity: false, allowNaN: false, maxDecimalPlaces: 4 },
    { message: 'El descuento de línea debe ser un número' },
  )
  @Min(0, { message: 'El descuento de línea no puede ser negativo' })
  @Max(MAX_IMPORTE, { message: 'El descuento de línea es demasiado grande' })
  lineDiscount?: number;

  /** Alternativa en porcentaje. Se resuelve a importe antes de calcular. */
  @IsOptional()
  @IsNumber(
    { allowInfinity: false, allowNaN: false, maxDecimalPlaces: 4 },
    { message: 'El porcentaje de descuento debe ser un número' },
  )
  @Min(0, { message: 'El porcentaje no puede ser negativo' })
  @Max(100, { message: 'El porcentaje no puede pasar de 100' })
  lineDiscountPercent?: number;
}

export class EconomiaDeCotizacionDto {
  @IsOptional()
  @IsNumber(
    { allowInfinity: false, allowNaN: false, maxDecimalPlaces: 4 },
    { message: 'El descuento debe ser un número' },
  )
  @Min(0, { message: 'El descuento no puede ser negativo' })
  @Max(MAX_IMPORTE, { message: 'El descuento es demasiado grande' })
  discount?: number;

  @IsOptional()
  @IsNumber(
    { allowInfinity: false, allowNaN: false, maxDecimalPlaces: 4 },
    { message: 'El transporte debe ser un número' },
  )
  @Min(0, { message: 'El transporte no puede ser negativo' })
  @Max(MAX_IMPORTE, { message: 'El transporte es demasiado grande' })
  shipping?: number;

  /**
   * Puede ser NEGATIVO a proposito: es el campo con el que se pacta una rebaja
   * o un redondeo. El servidor comprueba despues que el total no quede negativo.
   */
  @IsOptional()
  @IsNumber(
    { allowInfinity: false, allowNaN: false, maxDecimalPlaces: 4 },
    { message: 'El ajuste debe ser un número' },
  )
  @Min(-MAX_IMPORTE, { message: 'El ajuste es demasiado grande' })
  @Max(MAX_IMPORTE, { message: 'El ajuste es demasiado grande' })
  adjustment?: number;

  @IsOptional()
  @IsNumber(
    { allowInfinity: false, allowNaN: false, maxDecimalPlaces: 4 },
    { message: 'El impuesto debe ser un número' },
  )
  @Min(0, { message: 'El impuesto no puede ser negativo' })
  @Max(100, { message: 'El impuesto es un porcentaje: como mucho 100' })
  taxRate?: number;

  /** `true` si el precio unitario YA lleva el impuesto dentro. */
  @IsOptional()
  @IsBoolean({ message: '«impuesto incluido» debe ser verdadero o falso' })
  taxIncluded?: boolean;

  /** Para qué es el ajuste. Sale impreso en el PDF junto al importe. */
  @IsOptional()
  @IsString()
  @MaxLength(80, { message: 'La etiqueta del ajuste es demasiado larga' })
  adjustmentLabel?: string;

  /**
   * Líneas a modificar, por su id. Solo las que se envían cambian.
   *
   * El tope de 500 no es decorativo: cada línea entra en el recálculo y en el
   * PDF, y un cuerpo con cien mil líneas es una forma barata de tumbar el
   * proceso.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500, { message: 'Demasiadas líneas en una sola petición' })
  @ValidateNested({ each: true })
  @Type(() => LineaDeCotizacionDto)
  lineas?: LineaDeCotizacionDto[];
}
