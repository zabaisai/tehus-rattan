import { Prisma } from '@prisma/client';

/**
 * Aritmetica de dinero. Exacta en base 10, que es la base en la que se factura.
 *
 * Existe para que sumar importes no vuelva a pasar por `number`. La coma
 * flotante binaria no representa 0,1 exactamente: `0.1 + 0.2` es
 * `0.30000000000000004`, y sumar mil lineas de una cotizacion acumula ese
 * error hasta que el total no cuadra con la suma de sus partes. Quien lo mira
 * concluye —con razon— que el sistema calcula mal.
 *
 * La regla es: el dinero entra como Decimal, se opera como Decimal y solo se
 * convierte a `number` en el ultimo momento, para pintarlo o serializarlo.
 */
export type Dinero = Prisma.Decimal;

export const CERO: Dinero = new Prisma.Decimal(0);

/** Convierte a Decimal cualquier forma en la que pueda llegar un importe. */
export function dinero(valor: Prisma.Decimal.Value | null | undefined): Dinero {
  if (valor === null || valor === undefined) return CERO;
  return new Prisma.Decimal(valor);
}

export function suma(
  ...valores: Array<Prisma.Decimal.Value | null | undefined>
): Dinero {
  return valores.reduce<Dinero>((acc, v) => acc.plus(dinero(v)), CERO);
}

export function resta(
  a: Prisma.Decimal.Value,
  b: Prisma.Decimal.Value,
): Dinero {
  return dinero(a).minus(dinero(b));
}

export function multiplica(
  a: Prisma.Decimal.Value,
  b: Prisma.Decimal.Value,
): Dinero {
  return dinero(a).times(dinero(b));
}

/**
 * Un porcentaje aplicado a un importe. `porcentaje` va en unidades humanas:
 * 19 significa 19 %, no 0,19. Escribirlo al reves es el error clasico y por
 * eso la division por 100 vive aqui dentro y no en cada llamada.
 */
export function porcentajeDe(
  base: Prisma.Decimal.Value,
  porcentaje: Prisma.Decimal.Value,
): Dinero {
  return dinero(base).times(dinero(porcentaje)).dividedBy(100);
}

/**
 * Redondeo a la moneda. `HALF_UP` —la mitad sube— porque es lo que espera
 * cualquiera que mire una factura, y lo que usan las normas contables de la
 * region. El modo por defecto de IEEE 754 es «la mitad al par», que reparte
 * mejor el error estadistico y sorprende a todo el mundo en un recibo.
 */
export function redondea(valor: Prisma.Decimal.Value, decimales = 2): Dinero {
  return dinero(valor).toDecimalPlaces(decimales, Prisma.Decimal.ROUND_HALF_UP);
}

/** Nunca por debajo de cero: un total negativo no es un cobro, es un error. */
export function noNegativo(valor: Prisma.Decimal.Value): Dinero {
  const d = dinero(valor);
  return d.isNegative() ? CERO : d;
}

export function esNegativo(
  valor: Prisma.Decimal.Value | null | undefined,
): boolean {
  return dinero(valor).isNegative();
}

export function mayorQue(
  a: Prisma.Decimal.Value | null | undefined,
  b: Prisma.Decimal.Value | null | undefined,
): boolean {
  return dinero(a).greaterThan(dinero(b));
}

/**
 * A `number`, SOLO para salir por la API o pintarse.
 *
 * Se llama asi de largo a proposito: cada llamada es un punto donde el importe
 * deja de ser exacto, y conviene que se vea al leer el codigo.
 */
export function aNumeroParaMostrar(
  valor: Prisma.Decimal.Value | null | undefined,
): number {
  return dinero(valor).toNumber();
}
