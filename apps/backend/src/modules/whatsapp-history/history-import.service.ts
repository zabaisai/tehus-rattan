import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ContactsService } from '../contacts/contacts.service';
import { ConversationsService } from '../conversations/conversations.service';
import { normalizePhone } from '../../common/phone/e164.util';

export interface FilaHistorial {
  telefono: string;
  fecha: Date;
  direccion: 'INBOUND' | 'OUTBOUND';
  texto: string;
  /** Identificador propio del origen, para poder reimportar sin duplicar. */
  referencia: string;
}

export interface ResultadoImportacion {
  filasLeidas: number;
  importados: number;
  duplicados: number;
  rechazados: Array<{ fila: number; motivo: string }>;
}

/** Tope por importación. Más que esto se parte en varios ficheros. */
export const MAXIMO_FILAS = 20_000;

const CABECERAS = ['telefono', 'fecha', 'direccion', 'texto', 'referencia'];

/**
 * Importación controlada de historial desde CSV.
 *
 * ES LA ÚNICA VÍA GARANTIZADA. La Cloud API no expone ningún endpoint para
 * pedir mensajes pasados, y la sincronización de coexistencia solo ocurre al
 * conectar un número que venía de la app de WhatsApp Business. Para todo lo
 * demás —una migración desde otro CRM, un export manual— el camino es este.
 *
 * Como la sincronización de historial, **nada de lo importado dispara
 * efectos**: se marca `CSV_IMPORT` y no pasa por automatizaciones, chatbot ni
 * creación de oportunidades.
 *
 * La `referencia` de cada fila es obligatoria y se convierte en el `wamid`
 * del mensaje. Es lo que hace que reimportar el mismo fichero no duplique
 * nada: sin ella, un segundo intento tras un fallo a mitad dejaría el hilo
 * con todo por duplicado.
 */
@Injectable()
export class HistoryImportService {
  private readonly logger = new Logger(HistoryImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly conversations: ConversationsService,
  ) {}

  /**
   * Analiza el CSV sin importar nada.
   *
   * Se ofrece aparte a propósito: quien importa historial quiere ver qué se
   * va a meter antes de meterlo, y descubrir a mitad que el formato de fecha
   * era otro deja el hilo con la mitad de las conversaciones.
   */
  analizar(csv: string): {
    filas: FilaHistorial[];
    rechazados: Array<{ fila: number; motivo: string }>;
  } {
    const lineas = csv
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (!lineas.length) {
      throw new BadRequestException('El fichero está vacío.');
    }

    const cabecera = this.separar(lineas[0]).map((c) => c.trim().toLowerCase());
    const faltan = CABECERAS.filter((c) => !cabecera.includes(c));
    if (faltan.length) {
      throw new BadRequestException(
        `Faltan columnas obligatorias: ${faltan.join(', ')}. Se esperan: ${CABECERAS.join(', ')}.`,
      );
    }

    if (lineas.length - 1 > MAXIMO_FILAS) {
      throw new BadRequestException(
        `El fichero tiene más de ${MAXIMO_FILAS} filas. Pártelo en varios.`,
      );
    }

    const indice = Object.fromEntries(
      CABECERAS.map((c) => [c, cabecera.indexOf(c)]),
    );

    const filas: FilaHistorial[] = [];
    const rechazados: Array<{ fila: number; motivo: string }> = [];

    lineas.slice(1).forEach((linea, i) => {
      const numero = i + 2; // +1 por la cabecera, +1 porque se cuenta desde 1
      const celdas = this.separar(linea);

      const telefonoBruto = celdas[indice.telefono]?.trim();
      // Se reutiliza la normalizacion del CRM: si el importado quedara en
      // otro formato, cada contacto tendria dos fichas y ninguna con el hilo
      // completo.
      const telefono = telefonoBruto
        ? normalizePhone(telefonoBruto).e164
        : null;
      if (!telefono) {
        rechazados.push({
          fila: numero,
          motivo: 'Teléfono ausente o inválido',
        });
        return;
      }

      const fecha = new Date(celdas[indice.fecha]?.trim() ?? '');
      if (Number.isNaN(fecha.getTime())) {
        rechazados.push({
          fila: numero,
          motivo:
            'Fecha ilegible (se espera ISO 8601, p. ej. 2026-03-01T10:15:00Z)',
        });
        return;
      }
      // Una fecha futura en un historial es siempre un error de formato —
      // típicamente día y mes intercambiados—. Importarla desordenaría el hilo.
      if (fecha.getTime() > Date.now()) {
        rechazados.push({ fila: numero, motivo: 'Fecha en el futuro' });
        return;
      }

      const direccionBruta = celdas[indice.direccion]?.trim().toUpperCase();
      if (direccionBruta !== 'INBOUND' && direccionBruta !== 'OUTBOUND') {
        rechazados.push({
          fila: numero,
          motivo: 'Dirección debe ser INBOUND u OUTBOUND',
        });
        return;
      }

      const referencia = celdas[indice.referencia]?.trim();
      if (!referencia) {
        // Sin referencia no hay forma de reimportar sin duplicar.
        rechazados.push({ fila: numero, motivo: 'Referencia obligatoria' });
        return;
      }

      filas.push({
        telefono,
        fecha,
        direccion: direccionBruta,
        texto: celdas[indice.texto] ?? '',
        referencia,
      });
    });

    return { filas, rechazados };
  }

  async importar(
    companyId: string,
    csv: string,
  ): Promise<ResultadoImportacion> {
    const { filas, rechazados } = this.analizar(csv);

    let importados = 0;
    let duplicados = 0;

    // Los hilos se resuelven una vez por teléfono, no una por fila: con mil
    // mensajes de veinte contactos, lo contrario son mil búsquedas.
    const hilos = new Map<string, string>();

    for (const fila of filas) {
      let conversationId = hilos.get(fila.telefono);
      if (!conversationId) {
        conversationId = await this.hiloDe(companyId, fila.telefono);
        hilos.set(fila.telefono, conversationId);
      }

      try {
        await this.prisma.message.create({
          data: {
            conversationId,
            // La referencia del origen se usa como identificador único, con
            // prefijo para no colisionar nunca con un wamid real de Meta.
            wamid: `csv:${companyId}:${fila.referencia}`,
            body: fila.texto,
            direction: fila.direccion,
            status: fila.direccion === 'INBOUND' ? 'RECEIVED' : 'SENT',
            source: 'CSV_IMPORT',
            createdAt: fila.fecha,
          },
        });
        importados += 1;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          duplicados += 1;
          continue;
        }
        throw error;
      }
    }

    this.logger.log(
      `Importación CSV: ${importados} mensajes, ${duplicados} ya existían, ${rechazados.length} rechazados`,
    );

    return {
      filasLeidas: filas.length + rechazados.length,
      importados,
      duplicados,
      rechazados,
    };
  }

  private async hiloDe(companyId: string, telefono: string): Promise<string> {
    let contacto = await this.prisma.contact.findFirst({
      where: { phone: telefono, companyId },
      select: { id: true },
    });
    if (!contacto) {
      contacto = await this.contacts.create(companyId, { phone: telefono });
    }
    const conversacion = await this.conversations.findOrCreate(
      companyId,
      contacto.id,
    );
    return conversacion.id;
  }

  /**
   * Separador de CSV con comillas.
   *
   * Se escribe a mano porque el texto de un mensaje de WhatsApp lleva comas,
   * saltos y comillas con toda normalidad, y un `split(',')` parte los
   * mensajes por la mitad — el fallo se ve solo cuando alguien lee el hilo
   * importado meses después.
   */
  private separar(linea: string): string[] {
    const celdas: string[] = [];
    let actual = '';
    let entreComillas = false;

    for (let i = 0; i < linea.length; i++) {
      const c = linea[i];

      if (entreComillas) {
        if (c === '"') {
          // Comilla doble escapada dentro de un campo entrecomillado.
          if (linea[i + 1] === '"') {
            actual += '"';
            i++;
          } else {
            entreComillas = false;
          }
        } else {
          actual += c;
        }
        continue;
      }

      if (c === '"') entreComillas = true;
      else if (c === ',') {
        celdas.push(actual);
        actual = '';
      } else actual += c;
    }

    celdas.push(actual);
    return celdas;
  }
}
