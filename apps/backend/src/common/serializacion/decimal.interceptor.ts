import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Convierte los `Decimal` de Prisma a numero ANTES de que el serializador de
 * clases toque la respuesta.
 *
 * POR QUE EXISTE
 *
 * `ClassSerializerInterceptor` usa `instanceToPlain`, que enumera las
 * propiedades PROPIAS del objeto en vez de llamar a su `toJSON`. Las
 * propiedades propias de un Decimal de decimal.js son `s`, `e` y `d`, asi que
 * un importe salia por la API como:
 *
 *     {"s":1,"e":6,"d":[4500000]}
 *
 * En el navegador eso es `NaN`. Se veia como «$ NaN» en cada tarjeta del
 * tablero, y no lo detecto ninguna prueba porque todas comprueban el servicio
 * —donde el valor todavia es un Decimal correcto— y no lo que sale por HTTP.
 *
 * Este interceptor se registra DESPUES del de clases precisamente para que en
 * el camino de VUELTA se ejecute ANTES: en Nest la respuesta atraviesa los
 * interceptores en orden inverso al de registro.
 *
 * A NUMERO Y NO A CADENA porque es lo que el frontend ya esperaba de toda la
 * vida, cuando esto era `Float`. Cambiarlo a cadena obligaria a repasar cada
 * pantalla que pinta dinero, que es exactamente el trabajo que este
 * interceptor evita.
 *
 * La precision se conserva donde importa —en la base y en el calculo, que
 * siguen siendo Decimal—; esto es la frontera de presentacion.
 */
@Injectable()
export class DecimalInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((datos) => convertir(datos)));
  }
}

/**
 * Recorre la respuesta sustituyendo Decimals.
 *
 * `Buffer` y `Date` se dejan en paz: el PDF de una cotizacion es un Buffer, y
 * recorrerlo byte a byte lo destruiria ademas de costar una eternidad.
 */
function convertir(valor: unknown, profundidad = 0): unknown {
  // Un tope de profundidad evita que una estructura ciclica —o absurdamente
  // anidada— cuelgue el proceso.
  if (profundidad > 12) return valor;

  if (valor instanceof Prisma.Decimal) return valor.toNumber();

  if (
    valor === null ||
    valor === undefined ||
    typeof valor !== 'object' ||
    valor instanceof Date ||
    Buffer.isBuffer(valor)
  ) {
    return valor;
  }

  if (Array.isArray(valor)) {
    return valor.map((v) => convertir(v, profundidad + 1));
  }

  // Se construye un objeto NUEVO en vez de mutar el que llega: mutar la
  // entidad de Prisma la dejaria alterada para cualquier otro uso dentro de
  // la misma peticion.
  const salida: Record<string, unknown> = {};
  for (const [clave, v] of Object.entries(valor as Record<string, unknown>)) {
    salida[clave] = convertir(v, profundidad + 1);
  }
  return salida;
}
