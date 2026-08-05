import { Logger } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { WhatsAppTokenCryptoService } from '../../../whatsapp-integration/whatsapp-token-crypto.service';
import { PuertoHttp } from '../flowbot.ports';
import {
  filtrarCabeceras,
  httpEsReintentable,
  metodoPermitido,
  revisarDns,
  revisarUrl,
} from './flowbot.http.guard';

/**
 * Adaptador REAL de llamadas HTTP salientes.
 *
 * ES LA PIEZA MÁS PELIGROSA DEL MOTOR. Un nodo que puede pedir cualquier URL
 * desde dentro de la red del CRM es un proxy con las credenciales de la
 * empresa dentro. Por eso todo lo que aquí se hace es restrictivo por defecto:
 *
 *   1. HTTP apagado salvo que la empresa lo encienda.
 *   2. Lista de destinos, y VACÍA significa ninguno.
 *   3. Solo HTTPS, solo el puerto 443, sin credenciales en la URL.
 *   4. Resolución de DNS y comprobación de TODAS las IPs.
 *   5. Sin seguir redirecciones automáticamente.
 *   6. Tiempo límite y tope de respuesta.
 *   7. Métodos y cabeceras de una lista cerrada.
 *   8. Credenciales cifradas que el flujo nunca ve.
 *
 * NO USA AXIOS. El `fetch` de Node deja controlar la redirección y leer el
 * cuerpo por trozos para cortar en cuanto pasa del tope; con axios habría que
 * confiar en `maxContentLength`, que solo mira la cabecera y no protege de un
 * servidor que miente.
 */

export class ErrorHttp extends Error {
  /** La lee el intérprete para decidir si reintenta. */
  readonly clase:
    | 'externo_transitorio'
    | 'externo_definitivo'
    | 'configuracion';

  constructor(
    readonly errorCode: string,
    clase: ErrorHttp['clase'],
  ) {
    super(errorCode);
    this.name = 'ErrorHttp';
    this.clase = clase;
  }
}

/** Lo que el adaptador necesita saber de la empresa. */
interface ConfiguracionHttp {
  httpEnabled: boolean;
  httpAllowedHosts: string[];
  httpTimeoutMs: number;
  httpMaxResponseBytes: number;
}

const POR_DEFECTO: ConfiguracionHttp = {
  httpEnabled: false,
  httpAllowedHosts: [],
  httpTimeoutMs: 10_000,
  httpMaxResponseBytes: 262_144,
};

export class HttpAdapter implements PuertoHttp {
  private readonly logger = new Logger(HttpAdapter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly companyId: string,
    private readonly cripto: WhatsAppTokenCryptoService,
  ) {}

  async llamar(input: {
    url: string;
    metodo: string;
    cabeceras?: Record<string, string>;
    cuerpo?: unknown;
    credentialId?: string;
  }): Promise<{ estado: number; datos: unknown }> {
    const config = await this.configuracion();

    // 1. Apagado por defecto. Un motor que puede llamar a cualquier sitio
    // desde el minuto cero es una fuga esperando a ocurrir.
    if (!config.httpEnabled) {
      throw new ErrorHttp('http-no-configurado', 'configuracion');
    }

    // 2 y 3. Forma de la URL y lista de destinos.
    const forma = revisarUrl(input.url, config.httpAllowedHosts);
    if (!forma.ok || !forma.destino) {
      this.logger.warn(
        `Llamada HTTP bloqueada [${forma.motivo}] ${forma.detalle ?? ''}`,
      );
      throw new ErrorHttp(`http-${forma.motivo}`, 'configuracion');
    }

    if (!metodoPermitido(input.metodo)) {
      throw new ErrorHttp('http-metodo-no-permitido', 'configuracion');
    }

    // 4. DNS. El validador comprobó la FORMA al publicar, pero `evil.com`
    // puede resolver a `10.0.0.5` justo ahora.
    const dns = await revisarDns(forma.destino.hostname);
    if (!dns.ok) {
      this.logger.warn(`Llamada HTTP bloqueada por DNS [${dns.motivo}]`);
      throw new ErrorHttp(`http-${dns.motivo}`, 'configuracion');
    }

    const { seguras, descartadas } = filtrarCabeceras(input.cabeceras);
    if (descartadas.length > 0) {
      // Se dice cuáles, no se ignoran en silencio: quien escribió el flujo
      // tiene que saber por qué su cabecera no llegó.
      this.logger.warn(
        `Cabeceras descartadas en la llamada HTTP: ${descartadas.join(', ')}`,
      );
    }

    // 8. La credencial se descifra AQUÍ y muere con la llamada. El flujo no la
    // ve en ningún momento: si pudiera leerla, cualquiera con permiso para
    // editar un bot la exfiltraría mandándosela con otro nodo.
    const autorizacion = await this.autorizacion(input.credentialId);

    const controlador = new AbortController();
    const reloj = setTimeout(
      () => controlador.abort(),
      Math.min(config.httpTimeoutMs, 30_000),
    );

    try {
      const respuesta = await fetch(forma.destino.toString(), {
        method: input.metodo.toUpperCase(),
        // 5. NO seguir redirecciones. Un 302 a `http://169.254.169.254`
        // saltaría todas las comprobaciones anteriores, que se hicieron sobre
        // la URL original.
        redirect: 'manual',
        headers: {
          ...seguras,
          ...autorizacion,
          accept: 'application/json, text/plain;q=0.9, */*;q=0.5',
          'user-agent': 'TAKTO-FlowBot/1.0',
          ...(input.cuerpo !== undefined
            ? { 'content-type': 'application/json' }
            : {}),
        },
        body:
          input.cuerpo !== undefined ? JSON.stringify(input.cuerpo) : undefined,
        signal: controlador.signal,
      });

      if (respuesta.status >= 300 && respuesta.status < 400) {
        // Se trata como un fallo definitivo y no se sigue: el destino nuevo no
        // pasó por ninguna de las guardas.
        throw new ErrorHttp(
          'http-redireccion-no-seguida',
          'externo_definitivo',
        );
      }

      const datos = await this.leerAcotado(
        respuesta,
        config.httpMaxResponseBytes,
      );

      if (respuesta.status >= 400) {
        throw new ErrorHttp(
          `http-${respuesta.status}`,
          httpEsReintentable(respuesta.status)
            ? 'externo_transitorio'
            : 'externo_definitivo',
        );
      }

      await this.marcarUso(input.credentialId);
      return { estado: respuesta.status, datos };
    } catch (error) {
      if (error instanceof ErrorHttp) throw error;

      // Del fallo de red solo el clasificador: el mensaje del agente HTTP
      // lleva la URL completa, y esta acaba en logs compartidos.
      const abortado = error instanceof Error && error.name === 'AbortError';
      throw new ErrorHttp(
        abortado ? 'http-tiempo-agotado' : 'http-red',
        'externo_transitorio',
      );
    } finally {
      clearTimeout(reloj);
    }
  }

  /**
   * Lee la respuesta cortando en cuanto pasa del tope.
   *
   * POR TROZOS Y NO CON `.text()`. Un servidor que devuelve un gigabyte tumba
   * el worker por memoria antes de que nadie pueda mirar la longitud, y
   * `content-length` no sirve: un servidor puede mentir o no enviarla.
   */
  private async leerAcotado(
    respuesta: Response,
    maximo: number,
  ): Promise<unknown> {
    const lector = respuesta.body?.getReader();
    if (!lector) return null;

    const trozos: Uint8Array[] = [];
    let total = 0;

    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > maximo) {
        await lector.cancel().catch(() => undefined);
        throw new ErrorHttp(
          'http-respuesta-demasiado-grande',
          'externo_definitivo',
        );
      }
      trozos.push(value);
    }

    const texto = Buffer.concat(trozos).toString('utf8');
    if (!texto.trim()) return null;

    try {
      return JSON.parse(texto) as unknown;
    } catch {
      // No todo el mundo devuelve JSON. Se entrega el texto tal cual en vez de
      // fallar: el flujo puede querer solo el código de estado.
      return texto;
    }
  }

  /** La cabecera de autorización que corresponda, o nada. */
  private async autorizacion(
    credentialId?: string,
  ): Promise<Record<string, string>> {
    if (!credentialId) return {};

    const credencial = await this.prisma.flowBotCredential.findFirst({
      // Acotada por empresa: un `credentialId` de otra empresa simplemente no
      // se encuentra.
      where: { id: credentialId, companyId: this.companyId },
    });
    if (!credencial) {
      throw new ErrorHttp('http-credencial-no-encontrada', 'configuracion');
    }

    let secreto: string;
    try {
      secreto = this.cripto.decrypt(credencial.secretEncrypted);
    } catch {
      // Alguien tiene que volver a guardarla: reintentarlo no la descifra.
      throw new ErrorHttp('http-credencial-ilegible', 'configuracion');
    }

    switch (credencial.type) {
      case 'BEARER_TOKEN':
        return { authorization: `Bearer ${secreto}` };
      case 'BASIC_AUTH': {
        const par = `${credencial.username ?? ''}:${secreto}`;
        return {
          authorization: `Basic ${Buffer.from(par).toString('base64')}`,
        };
      }
      case 'API_KEY_HEADER': {
        const nombre = credencial.headerName?.trim().toLowerCase();
        // El nombre se valida aquí también: una cabecera con salto de línea
        // permite inyectar otras, incluida una segunda autorización.
        if (!nombre || !/^[a-z0-9-]{1,64}$/.test(nombre)) {
          throw new ErrorHttp(
            'http-credencial-mal-configurada',
            'configuracion',
          );
        }
        return { [nombre]: secreto };
      }
    }
  }

  private async marcarUso(credentialId?: string): Promise<void> {
    if (!credentialId) return;
    await this.prisma.flowBotCredential
      .updateMany({
        where: { id: credentialId, companyId: this.companyId },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => undefined);
  }

  private async configuracion(): Promise<ConfiguracionHttp> {
    const c = await this.prisma.flowBotSettings.findUnique({
      where: { companyId: this.companyId },
      select: {
        httpEnabled: true,
        httpAllowedHosts: true,
        httpTimeoutMs: true,
        httpMaxResponseBytes: true,
      },
    });
    return c ?? POR_DEFECTO;
  }
}
