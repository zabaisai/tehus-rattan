import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { WhatsAppTokenCryptoService } from '../../../whatsapp-integration/whatsapp-token-crypto.service';
import { PuertoIa } from '../flowbot.ports';
import {
  MAX_TEXTO_IA,
  ProveedorIa,
  RegistroProveedoresIa,
  RespuestaIa,
  redactarPii,
} from './flowbot.ia.provider';

/**
 * Adaptador de IA.
 *
 * TODO LO QUE NO ES «hablar con el modelo» vive aquí, igual que en WhatsApp:
 * configuración de la empresa, topes de gasto, redacción de PII, prompt del
 * sistema, tiempo límite, validación de la salida y la decisión de cuándo
 * entregar a una persona.
 *
 * SIN PROVEEDOR CONFIGURADO, `disponible()` responde que no y los nodos salen
 * por su rama de reserva. Es la diferencia entre «la IA no contestó» y «el bot
 * se rompió»: el flujo sigue, y quien lo diseñó ya decidió qué hacer sin ella.
 */

export class ErrorIa extends Error {
  readonly clase:
    'externo_transitorio' | 'externo_definitivo' | 'configuracion';

  constructor(
    readonly errorCode: string,
    clase: ErrorIa['clase'],
  ) {
    super(errorCode);
    this.name = 'ErrorIa';
    this.clase = clase;
  }
}

interface ConfiguracionIa {
  aiEnabled: boolean;
  aiProvider: string | null;
  aiModel: string | null;
  aiApiKeyEncrypted: string | null;
  aiMaxTokensPerCall: number;
  aiMaxCallsPerDay: number;
  aiTimeoutMs: number;
  aiRedactPii: boolean;
  aiSystemPrompt: string | null;
}

@Injectable()
export class IaAdapter implements PuertoIa {
  private readonly logger = new Logger(IaAdapter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly companyId: string,
    private readonly registro: RegistroProveedoresIa,
    private readonly cripto: WhatsAppTokenCryptoService,
  ) {}

  /**
   * ¿Se puede usar IA ahora mismo?
   *
   * Comprueba las CUATRO cosas: encendida, proveedor registrado, clave
   * guardada y cuota del día sin agotar. Los nodos preguntan esto antes de
   * llamar, así que un tope alcanzado saca el flujo por su rama de reserva en
   * vez de convertirse en un error.
   */
  async disponible(): Promise<boolean> {
    const config = await this.configuracion();
    if (!config.aiEnabled) return false;
    if (!this.registro.obtener(config.aiProvider)) return false;
    if (!config.aiApiKeyEncrypted) return false;
    return !(await this.cuotaAgotada(config));
  }

  /**
   * Elige UNA de las opciones dadas. No puede inventar otras.
   *
   * ES LA ÚNICA FORMA DE QUE UN MOTOR DETERMINISTA PUEDA USAR UN MODELO DE
   * LENGUAJE. Con texto libre, el flujo tendría que adivinar a qué rama
   * corresponde la respuesta; con opciones cerradas, la salida es un puerto.
   *
   * Si el modelo devuelve algo que no está en la lista, se descarta y se sale
   * con confianza cero: aceptar «casi» la opción correcta es como se acaba
   * mandando al cliente por la rama equivocada.
   */
  async clasificar(input: {
    companyId: string;
    texto: string;
    opciones: string[];
  }): Promise<{ eleccion: string | null; confianza: number }> {
    const r = await this.llamar({
      usuario: input.texto,
      opciones: input.opciones,
    });

    if (!r.ok || !r.eleccion) return { eleccion: null, confianza: 0 };

    // Se vuelve a comprobar CONTRA LA LISTA aunque el proveedor ya debería
    // haberlo hecho: la respuesta de un modelo es entrada no confiable.
    const valida = input.opciones.find(
      (o) => o.toLowerCase() === r.eleccion!.toLowerCase(),
    );
    return valida
      ? { eleccion: valida, confianza: r.confianza }
      : { eleccion: null, confianza: 0 };
  }

  /**
   * Extrae campos concretos de un texto.
   *
   * SALIDA ESTRUCTURADA Y VALIDADA: se pide JSON con las claves declaradas y
   * se descarta cualquiera que no estuviera en la lista. Un modelo que se
   * inventa un campo llenaria el CRM de datos que nadie pidio.
   */
  async extraer(input: {
    companyId: string;
    texto: string;
    campos: string[];
  }): Promise<Record<string, string>> {
    if (input.campos.length === 0) return {};

    const r = await this.llamar({
      usuario: input.texto,
      instrucciones:
        `Extrae estos campos y responde SOLO con un objeto JSON con esas ` +
        `claves exactas: ${input.campos.join(', ')}. ` +
        `Si un campo no aparece, usa null.`,
    });
    if (!r.ok || !r.texto) return {};

    let crudo: unknown;
    try {
      crudo = JSON.parse(r.texto);
    } catch {
      // Un modelo que no devuelve JSON valido no es un fallo del sistema: el
      // flujo se queda sin datos y sigue por donde su autor decidio.
      return {};
    }
    if (!crudo || typeof crudo !== 'object') return {};

    const limpio: Record<string, string> = {};
    for (const campo of input.campos) {
      const v = (crudo as Record<string, unknown>)[campo];
      // Solo cadenas y numeros: un objeto anidado se convertiria en
      // "[object Object]" y guardariamos basura creyendo que es un dato.
      if (typeof v === 'string' && v.trim()) limpio[campo] = v.trim();
      else if (typeof v === 'number' && Number.isFinite(v)) {
        limpio[campo] = String(v);
      }
    }
    return limpio;
  }

  /** Reescribe un texto siguiendo instrucciones. */
  async redactar(input: {
    companyId: string;
    instrucciones: string;
    texto: string;
  }): Promise<string> {
    const r = await this.llamar({
      usuario: input.texto,
      instrucciones: input.instrucciones,
    });
    // Cadena vacia y no `null`: quien llama espera un texto, y devolver el
    // original sin reescribir seria peor que no decir nada.
    return r.ok ? (r.texto ?? '') : '';
  }

  /**
   * Resume una conversacion.
   *
   * DEVUELVE VACIO porque el adaptador no puede leer los mensajes: el puerto
   * solo recibe el id, y darle Prisma le daria acceso a las conversaciones de
   * todas las empresas. Cuando exista un nodo que lo use, el texto tendra que
   * llegarle ya resuelto por el motor, que si sabe de quien es la
   * conversacion. Queda anotado como limitacion real.
   */
  async resumir(input: {
    companyId: string;
    conversationId: string;
  }): Promise<string> {
    this.logger.debug(
      `Resumen de conversacion no implementado [conv=${input.conversationId}]`,
    );
    return '';
  }

  // ── el camino común ─────────────────────────────────────────

  private async llamar(op: {
    usuario: string;
    instrucciones?: string;
    opciones?: string[];
    maxTokens?: number;
  }): Promise<RespuestaIa> {
    const config = await this.configuracion();

    if (!config.aiEnabled) {
      throw new ErrorIa('ia-no-configurada', 'configuracion');
    }
    const proveedor = this.registro.obtener(config.aiProvider);
    if (!proveedor) {
      throw new ErrorIa('ia-proveedor-desconocido', 'configuracion');
    }
    if (!config.aiApiKeyEncrypted) {
      throw new ErrorIa('ia-sin-credencial', 'configuracion');
    }
    if (await this.cuotaAgotada(config)) {
      // Definitivo y no transitorio: reintentarlo mañana lo arreglaría, pero
      // reintentarlo dentro de treinta segundos no, y el motor no sabe esperar
      // hasta mañana.
      throw new ErrorIa('ia-cuota-agotada', 'externo_definitivo');
    }

    let apiKey: string;
    try {
      apiKey = this.cripto.decrypt(config.aiApiKeyEncrypted);
    } catch {
      throw new ErrorIa('ia-credencial-ilegible', 'configuracion');
    }

    // LO QUE SALE NO VUELVE. Un proveedor guarda las peticiones para
    // depuración y a veces las usa para entrenar; un teléfono que se le manda
    // deja de estar bajo el control del CRM para siempre.
    const usuario = (
      config.aiRedactPii ? redactarPii(op.usuario) : op.usuario
    ).slice(0, MAX_TEXTO_IA);

    // El prompt del sistema es de la EMPRESA. El del nodo va como instrucción
    // del usuario, no encima: el autor de un flujo no puede reescribir las
    // reglas de la empresa desde el texto de un nodo.
    const sistema = [config.aiSystemPrompt?.trim(), op.instrucciones?.trim()]
      .filter(Boolean)
      .join('\n\n');

    const respuesta = await this.conProveedor(proveedor, apiKey, {
      sistema,
      usuario,
      opciones: op.opciones,
      modelo: config.aiModel ?? 'default',
      maxTokens: Math.min(
        op.maxTokens ?? config.aiMaxTokensPerCall,
        config.aiMaxTokensPerCall,
      ),
      timeoutMs: Math.min(config.aiTimeoutMs, 60_000),
    });

    // El consumo se anota SIEMPRE, salga bien o mal: una llamada que falla
    // después de gastar tokens los gastó igual, y no contarla haría que el
    // tope se saltara solo con provocar errores.
    await this.anotarConsumo(respuesta);

    return respuesta;
  }

  private async conProveedor(
    proveedor: ProveedorIa,
    apiKey: string,
    peticion: Parameters<ProveedorIa['completar']>[0],
  ): Promise<RespuestaIa> {
    try {
      return await proveedor.completar(peticion, apiKey);
    } catch (error) {
      // Del error del proveedor solo el nombre: su mensaje suele incluir el
      // prompt entero, y con él lo que escribió el cliente.
      this.logger.warn(
        `Proveedor de IA falló [${
          error instanceof Error ? error.name : 'Error'
        }]`,
      );
      return {
        ok: false,
        confianza: 0,
        tokens: 0,
        costMillis: 0,
        errorCode: 'ia-proveedor-fallo',
      };
    }
  }

  /**
   * ¿Se acabó la cuota del día?
   *
   * Se cuenta por empresa y por día. Sin contar, el límite sería una promesa:
   * no se puede impedir la llamada 501 si nadie contó las 500 anteriores.
   */
  private async cuotaAgotada(config: ConfiguracionIa): Promise<boolean> {
    if (config.aiMaxCallsPerDay <= 0) return true;

    const uso = await this.prisma.flowBotAiUsage.findUnique({
      where: { companyId_day: { companyId: this.companyId, day: this.hoy() } },
      select: { calls: true },
    });
    return (uso?.calls ?? 0) >= config.aiMaxCallsPerDay;
  }

  private async anotarConsumo(r: RespuestaIa): Promise<void> {
    await this.prisma.flowBotAiUsage
      .upsert({
        where: {
          companyId_day: { companyId: this.companyId, day: this.hoy() },
        },
        create: {
          companyId: this.companyId,
          day: this.hoy(),
          calls: 1,
          tokens: r.tokens,
          costMillis: r.costMillis,
        },
        update: {
          calls: { increment: 1 },
          tokens: { increment: r.tokens },
          costMillis: { increment: r.costMillis },
        },
      })
      // Que falle el contador no puede tumbar la conversación; el tope se
      // aplicará con lo que sí esté contado.
      .catch(() => undefined);
  }

  /** Medianoche UTC del día actual: la columna es `@db.Date`. */
  private hoy(): Date {
    const ahora = new Date();
    return new Date(
      Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate()),
    );
  }

  private async configuracion(): Promise<ConfiguracionIa> {
    const c = await this.prisma.flowBotSettings.findUnique({
      where: { companyId: this.companyId },
    });
    return (
      c ?? {
        aiEnabled: false,
        aiProvider: null,
        aiModel: null,
        aiApiKeyEncrypted: null,
        aiMaxTokensPerCall: 500,
        aiMaxCallsPerDay: 500,
        aiTimeoutMs: 15_000,
        aiRedactPii: true,
        aiSystemPrompt: null,
      }
    );
  }
}
