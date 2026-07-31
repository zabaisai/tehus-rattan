import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ContactsService } from '../contacts/contacts.service';
import { ConversationsService } from '../conversations/conversations.service';
import { maskPhone } from '../../common/logging/redact';

export interface ResultadoHistorial {
  recibidos: number;
  importados: number;
  duplicados: number;
  descartados: number;
}

/**
 * Sincronización del historial que Meta entrega al conectar en **coexistencia**.
 *
 * LO QUE META PERMITE REALMENTE — y lo que no:
 *
 * · **No existe ningún endpoint para pedir mensajes pasados.** La Cloud API no
 *   expone el historial: los mensajes llegan por webhook y solo desde que la
 *   aplicación está suscrita a la WABA. Cualquier función del CRM que
 *   prometiera «traer las conversaciones anteriores» sería mentira.
 *
 * · **La única vía que sí entrega historial es la coexistencia**: cuando un
 *   número que venía usándose en la app de WhatsApp Business se conecta a la
 *   Cloud API mediante Embedded Signup con coexistencia, Meta envía por
 *   webhook, UNA SOLA VEZ y en lotes, los chats recientes. El alcance lo fija
 *   Meta, no el CRM.
 *
 * · Fuera de eso, la única forma de meter historial es la importación
 *   controlada por CSV (decisión cerrada 10).
 *
 * ESTE SERVICIO ES DEFENSIVO A PROPÓSITO. La forma exacta del payload la
 * define Meta y puede cambiar sin aviso: se lee lo que se reconoce, se
 * descarta lo que no, y en ningún caso se rompe el webhook — que es el mismo
 * por el que llegan los mensajes en vivo.
 *
 * NADA DE LO IMPORTADO DISPARA EFECTOS. Se marca `HISTORY_SYNC` y no pasa por
 * automatizaciones, chatbot, SLA ni creación de oportunidades. Un mensaje de
 * hace seis meses que dispare una automatización manda un WhatsApp real a un
 * cliente por una conversación que terminó hace medio año.
 */
@Injectable()
export class HistorySyncService {
  private readonly logger = new Logger(HistorySyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly conversations: ConversationsService,
  ) {}

  /**
   * Procesa un `value.history` de un webhook.
   *
   * @param valor el `value` del cambio, tal cual lo manda Meta.
   */
  async procesarHistorial(
    companyId: string,
    valor: unknown,
  ): Promise<ResultadoHistorial> {
    const resultado: ResultadoHistorial = {
      recibidos: 0,
      importados: 0,
      duplicados: 0,
      descartados: 0,
    };

    const hilos = this.extraerHilos(valor);
    if (!hilos.length) return resultado;

    for (const hilo of hilos) {
      const telefono = this.telefonoDe(hilo);
      if (!telefono) {
        resultado.descartados += 1;
        continue;
      }

      const mensajes = Array.isArray(hilo?.messages) ? hilo.messages : [];
      resultado.recibidos += mensajes.length;
      if (!mensajes.length) continue;

      let conversationId: string;
      try {
        conversationId = await this.hiloDe(companyId, telefono, hilo);
      } catch {
        resultado.descartados += mensajes.length;
        continue;
      }

      for (const mensaje of mensajes) {
        const guardado = await this.guardar(conversationId, mensaje, telefono);
        if (guardado === 'importado') resultado.importados += 1;
        else if (guardado === 'duplicado') resultado.duplicados += 1;
        else resultado.descartados += 1;
      }
    }

    this.logger.log(
      `Historial: ${resultado.importados} importados, ${resultado.duplicados} ya existían, ${resultado.descartados} descartados`,
    );
    return resultado;
  }

  // ── lectura defensiva del payload ───────────────────────────

  /**
   * Meta ha usado más de una forma para agrupar el historial. Se aceptan las
   * que se reconocen y se ignora el resto en vez de asumir una sola: si la
   * forma cambia, el CRM importa menos, no se cae.
   */
  private extraerHilos(valor: unknown): any[] {
    const v = valor as any;
    if (Array.isArray(v?.history)) return v.history;
    if (Array.isArray(v?.history?.threads)) return v.history.threads;
    if (Array.isArray(v?.threads)) return v.threads;
    return [];
  }

  private telefonoDe(hilo: any): string | null {
    const bruto =
      hilo?.contact?.wa_id ??
      hilo?.wa_id ??
      hilo?.contacts?.[0]?.wa_id ??
      hilo?.from;
    if (typeof bruto !== 'string' || !bruto.trim()) return null;
    // Meta entrega el número sin `+`; el CRM lo guarda en E.164.
    const limpio = bruto.trim();
    return limpio.startsWith('+') ? limpio : `+${limpio}`;
  }

  private async hiloDe(
    companyId: string,
    telefono: string,
    hilo: any,
  ): Promise<string> {
    let contacto = await this.prisma.contact.findFirst({
      where: { phone: telefono, companyId },
      select: { id: true },
    });

    if (!contacto) {
      const nombre =
        typeof hilo?.contact?.profile?.name === 'string'
          ? hilo.contact.profile.name
          : undefined;
      contacto = await this.contacts.create(companyId, {
        phone: telefono,
        name: nombre,
      });
    }

    const conversacion = await this.conversations.findOrCreate(
      companyId,
      contacto.id,
    );
    return conversacion.id;
  }

  private async guardar(
    conversationId: string,
    mensaje: any,
    telefono: string,
  ): Promise<'importado' | 'duplicado' | 'descartado'> {
    const wamid = typeof mensaje?.id === 'string' ? mensaje.id : null;
    const cuerpo =
      typeof mensaje?.text?.body === 'string'
        ? mensaje.text.body
        : typeof mensaje?.body === 'string'
          ? mensaje.body
          : '';

    // Sin identificador no hay idempotencia posible: reimportar duplicaría la
    // conversación entera. Se descarta antes que ensuciar el hilo.
    if (!wamid) return 'descartado';

    const cuando = this.fechaDe(mensaje);
    const entrante = this.esEntrante(mensaje, telefono);

    try {
      await this.prisma.message.create({
        data: {
          conversationId,
          wamid,
          body: cuerpo,
          direction: entrante ? 'INBOUND' : 'OUTBOUND',
          // El estado real de entrega de un mensaje antiguo no lo sabemos, y
          // fingir `DELIVERED` sería inventar información. `SENT` para los
          // salientes es lo más neutro que se puede afirmar.
          status: entrante ? 'RECEIVED' : 'SENT',
          source: 'HISTORY_SYNC',
          createdAt: cuando,
        },
      });
      return 'importado';
    } catch (error) {
      // El índice único de `wamid` es lo que hace la reimportación inofensiva:
      // Meta puede reenviar lotes y el resultado no cambia.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return 'duplicado';
      }
      this.logger.warn(
        `No se pudo importar un mensaje de ${maskPhone(telefono)} [${
          error instanceof Error ? error.name : 'Error'
        }]`,
      );
      return 'descartado';
    }
  }

  private fechaDe(mensaje: any): Date {
    const marca = Number(mensaje?.timestamp);
    // Meta manda segundos desde época. Una marca ausente o absurda cae a
    // "ahora", que es peor que la real pero no rompe el orden del hilo.
    if (!Number.isFinite(marca) || marca <= 0) return new Date();
    return new Date(marca * 1000);
  }

  private esEntrante(mensaje: any, telefono: string): boolean {
    if (typeof mensaje?.from === 'string') {
      const desde = mensaje.from.startsWith('+')
        ? mensaje.from
        : `+${mensaje.from}`;
      return desde === telefono;
    }
    // Coexistencia marca los salientes con `from_me`. Sin ninguna señal se
    // asume entrante: es lo más común en un historial de atención.
    if (typeof mensaje?.from_me === 'boolean') return !mensaje.from_me;
    return true;
  }
}
