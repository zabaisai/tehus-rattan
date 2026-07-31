import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsAppTokenCryptoService } from './whatsapp-token-crypto.service';

export interface EstadoRotacion {
  total: number;
  /** Ya cifradas con la clave actual. */
  conClaveActual: number;
  /** Pendientes de recifrar. */
  conClaveAnterior: number;
  /** No se pudieron descifrar con NINGUNA clave. */
  ilegibles: number;
  rotacionEnCurso: boolean;
}

export interface ResultadoRecifrado extends EstadoRotacion {
  recifradas: number;
  fallidas: number;
}

/**
 * Rotación de `WHATSAPP_TOKEN_ENCRYPTION_KEY`.
 *
 * EL PELIGRO CONCRETO: el token de WhatsApp es lo único que permite enviar
 * mensajes. Si una rotación mal hecha lo deja ilegible, el CRM sigue
 * funcionando en todo salvo en enviar — y el síntoma es «los mensajes no
 * llegan», sin ninguna pista que apunte a la clave.
 *
 * Por eso:
 *
 * 1. **Se verifica ANTES de escribir.** Cada token se recifra, se vuelve a
 *    descifrar con la clave actual y se compara con el original en memoria.
 *    Solo si coincide se guarda. Escribir primero y comprobar después deja la
 *    fila rota si la comprobación falla.
 *
 * 2. **Fila a fila, no en una transacción única.** Una empresa cuyo token no
 *    se pueda descifrar no debe impedir que las demás se migren. Se cuenta,
 *    se informa y se sigue.
 *
 * 3. **Nada se registra en claro.** Ni el token, ni la clave, ni fragmentos.
 *    El log dice cuántas y cuáles empresas, nunca qué.
 *
 * 4. **El rollback es no hacer nada.** Mientras la clave anterior siga
 *    configurada, los tokens sin recifrar se leen igual. Revertir es devolver
 *    la variable a su valor previo; no hay que deshacer escrituras.
 */
@Injectable()
export class TokenRotationService {
  private readonly logger = new Logger(TokenRotationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: WhatsAppTokenCryptoService,
  ) {}

  /**
   * Qué hay que migrar, sin tocar nada.
   *
   * Es lo que se mira antes de empezar y, sobre todo, lo que dice cuándo es
   * seguro retirar la clave anterior: cero pendientes.
   */
  async estado(): Promise<EstadoRotacion> {
    const integraciones = await this.prisma.whatsAppIntegration.findMany({
      select: { id: true, accessTokenEncrypted: true },
    });

    let conActual = 0;
    let conAnterior = 0;
    let ilegibles = 0;

    for (const integracion of integraciones) {
      if (!integracion.accessTokenEncrypted) continue;
      try {
        const { conClaveAnterior } = this.crypto.decryptWithInfo(
          integracion.accessTokenEncrypted,
        );
        if (conClaveAnterior) conAnterior += 1;
        else conActual += 1;
      } catch {
        ilegibles += 1;
      }
    }

    return {
      total: integraciones.length,
      conClaveActual: conActual,
      conClaveAnterior: conAnterior,
      ilegibles,
      rotacionEnCurso: this.crypto.rotacionEnCurso(),
    };
  }

  /**
   * Recifra con la clave actual todo lo que aún esté con la anterior.
   *
   * Idempotente: lo que ya está con la clave actual se salta, así que
   * ejecutarlo dos veces no cambia nada y ejecutarlo a medias se puede
   * retomar.
   */
  async recifrar(): Promise<ResultadoRecifrado> {
    const integraciones = await this.prisma.whatsAppIntegration.findMany({
      select: { id: true, companyId: true, accessTokenEncrypted: true },
    });

    let recifradas = 0;
    let fallidas = 0;
    let conActual = 0;
    let ilegibles = 0;

    for (const integracion of integraciones) {
      if (!integracion.accessTokenEncrypted) continue;

      let token: string;
      let conClaveAnterior: boolean;
      try {
        const info = this.crypto.decryptWithInfo(
          integracion.accessTokenEncrypted,
        );
        token = info.token;
        conClaveAnterior = info.conClaveAnterior;
      } catch {
        // Ni con la clave actual ni con la anterior. Se cuenta y se sigue:
        // parar aquí dejaría al resto de empresas sin migrar por culpa de una.
        ilegibles += 1;
        this.logger.error(
          `Token ilegible en la integración ${integracion.id} (empresa ${integracion.companyId}). Requiere reconexión manual.`,
        );
        continue;
      }

      if (!conClaveAnterior) {
        conActual += 1;
        continue;
      }

      try {
        const nuevoCifrado = this.crypto.encrypt(token);

        // VERIFICACIÓN ANTES DE ESCRIBIR. Si esto no coincide, la fila se
        // queda como estaba y sigue siendo legible con la clave anterior.
        const comprobado = this.crypto.decrypt(nuevoCifrado);
        if (comprobado !== token) {
          throw new Error('la verificación del recifrado no coincide');
        }

        await this.prisma.whatsAppIntegration.update({
          where: { id: integracion.id },
          data: { accessTokenEncrypted: nuevoCifrado },
        });
        recifradas += 1;
      } catch (error) {
        fallidas += 1;
        // Solo el clasificador: el mensaje de un error de cifrado puede
        // arrastrar material del propio token.
        this.logger.error(
          `No se pudo recifrar la integración ${integracion.id} [${
            error instanceof Error ? error.name : 'Error'
          }]`,
        );
      }
    }

    const resultado: ResultadoRecifrado = {
      total: integraciones.length,
      conClaveActual: conActual + recifradas,
      conClaveAnterior: 0,
      ilegibles,
      rotacionEnCurso: this.crypto.rotacionEnCurso(),
      recifradas,
      fallidas,
    };

    this.logger.log(
      `Recifrado: ${recifradas} migradas, ${fallidas} fallidas, ${ilegibles} ilegibles de ${integraciones.length}`,
    );

    return resultado;
  }

  /**
   * ¿Se puede retirar ya la clave anterior?
   *
   * Solo cuando no queda ninguna fila que la necesite Y ninguna ilegible: una
   * ilegible con la clave anterior puesta puede que aún se recupere; sin ella,
   * es definitiva.
   */
  async sePuedeRetirarLaClaveAnterior(): Promise<{
    seguro: boolean;
    motivo: string;
  }> {
    const estado = await this.estado();

    if (!estado.rotacionEnCurso) {
      return { seguro: true, motivo: 'No hay ninguna rotación en curso.' };
    }
    if (estado.conClaveAnterior > 0) {
      return {
        seguro: false,
        motivo: `Quedan ${estado.conClaveAnterior} integraciones cifradas con la clave anterior.`,
      };
    }
    if (estado.ilegibles > 0) {
      return {
        seguro: false,
        motivo: `Hay ${estado.ilegibles} integraciones ilegibles. Retirar la clave anterior las haría irrecuperables.`,
      };
    }
    return {
      seguro: true,
      motivo: 'Todas las integraciones usan la clave actual.',
    };
  }
}
