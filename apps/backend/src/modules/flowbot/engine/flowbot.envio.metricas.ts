import { Injectable } from '@nestjs/common';

/**
 * Cuántas veces pasó cada cosa al intentar enviar.
 *
 * SON CONTADORES EN MEMORIA, no una serie temporal. Se exponen por el estado
 * operativo y por el health, que es donde ya mira quien opera esto; montar un
 * Prometheus para catorce números sería más infraestructura que producto, y
 * añadir una dependencia de la que luego hay que responder.
 *
 * SIN PII, POR CONSTRUCCIÓN. Aquí solo entran nombres de contador; no hay
 * ningún sitio donde meter un teléfono aunque alguien quisiera. Es la razón de
 * que la clave sea un tipo cerrado y no un `string`: un `string` acabaría
 * llevando `bloqueado:573001112233` el día que alguien quiera «más detalle».
 */
export type Contador =
  | 'permitidos'
  | 'bloqueados.killSwitch'
  | 'bloqueados.allowlist'
  | 'bloqueados.frecuencia'
  | 'bloqueados.breaker'
  | 'bloqueados.handoff'
  | 'bloqueados.ventana'
  | 'bloqueados.ejecucion'
  | 'bloqueados.contadorCaido'
  | 'dryRun'
  | 'reintentos'
  | 'meta.429'
  | 'meta.5xx'
  | 'meta.timeoutAmbiguo'
  | 'necesitanAtencion'
  | 'breaker.aperturas'
  | 'breaker.cierres'
  | 'breaker.pruebas';

const CONTADORES: Contador[] = [
  'permitidos',
  'bloqueados.killSwitch',
  'bloqueados.allowlist',
  'bloqueados.frecuencia',
  'bloqueados.breaker',
  'bloqueados.handoff',
  'bloqueados.ventana',
  'bloqueados.ejecucion',
  'bloqueados.contadorCaido',
  'dryRun',
  'reintentos',
  'meta.429',
  'meta.5xx',
  'meta.timeoutAmbiguo',
  'necesitanAtencion',
  'breaker.aperturas',
  'breaker.cierres',
  'breaker.pruebas',
];

@Injectable()
export class MetricasEnvio {
  private readonly valores = new Map<Contador, number>();
  /** Cuánto tiempo acumulado ha estado algún breaker abierto, en ms. */
  private msEnAbierto = 0;
  private desde = new Date();

  incrementar(contador: Contador, cuantos = 1): void {
    this.valores.set(contador, (this.valores.get(contador) ?? 0) + cuantos);
  }

  sumarTiempoAbierto(ms: number): void {
    this.msEnAbierto += Math.max(0, ms);
  }

  /**
   * Traduce el motivo de un bloqueo a su contador.
   *
   * Vive aquí y no en quien bloquea para que añadir un guardarraíl nuevo no
   * obligue a acordarse de añadir también su métrica: lo que no encaje cae en
   * un cajón conocido en vez de desaparecer.
   */
  registrarBloqueo(bloqueos: readonly string[]): void {
    const mapa: Record<string, Contador> = {
      'kill-switch-activo': 'bloqueados.killSwitch',
      'empresa-no-permitida': 'bloqueados.allowlist',
      'numero-remitente-no-permitido': 'bloqueados.allowlist',
      'destinatario-no-permitido': 'bloqueados.allowlist',
      'limite-de-frecuencia': 'bloqueados.frecuencia',
      'circuito-abierto': 'bloqueados.breaker',
      'handoff-humano-activo': 'bloqueados.handoff',
      'fuera-de-ventana-sin-plantilla': 'bloqueados.ventana',
      'ejecucion-no-viva': 'bloqueados.ejecucion',
      'version-invalida': 'bloqueados.ejecucion',
    };

    // Se cuenta SOLO el primero de la lista para no inflar los contadores:
    // un envío bloqueado por cinco motivos sigue siendo un envío bloqueado.
    for (const b of bloqueos) {
      const contador = mapa[b];
      if (contador) {
        this.incrementar(contador);
        return;
      }
    }
  }

  /** Foto completa. Todos los contadores salen, aunque estén a cero. */
  foto(): {
    desde: string;
    contadores: Record<string, number>;
    msEnAbierto: number;
  } {
    const contadores: Record<string, number> = {};
    // Se listan todos y no solo los tocados: un contador ausente se lee como
    // «no se ha medido» y uno a cero como «no ha pasado», que es distinto.
    for (const c of CONTADORES) contadores[c] = this.valores.get(c) ?? 0;

    return {
      desde: this.desde.toISOString(),
      contadores,
      msEnAbierto: this.msEnAbierto,
    };
  }

  /**
   * Señales que merecen que alguien mire.
   *
   * NO SE INVENTA UN CANAL DE ALERTAS. Sin credenciales de un servicio externo
   * —que este trabajo no tiene ni debe tener— lo honesto es dejar la señal
   * donde ya se mira: el estado operativo y el health, que puede quedar
   * `degraded`. Un webhook a un sitio inventado sería peor que nada: parecería
   * que hay alerta y no la habría.
   */
  alertas(entrada: {
    breakersAbiertos: number;
    contadorDisponible: boolean;
    killSwitchActivo: boolean;
    ejecucionesEnAtencion: number;
    trabajosDiferidos: number;
  }): Array<{ nivel: 'aviso' | 'grave'; codigo: string; mensaje: string }> {
    const salida: Array<{
      nivel: 'aviso' | 'grave';
      codigo: string;
      mensaje: string;
    }> = [];

    if (!entrada.contadorDisponible) {
      salida.push({
        nivel: 'grave',
        codigo: 'contador-no-disponible',
        mensaje:
          'Redis no responde: los envíos reales están bloqueados hasta que vuelva.',
      });
    }
    if (entrada.breakersAbiertos >= 2) {
      salida.push({
        nivel: 'grave',
        codigo: 'varios-numeros-abiertos',
        mensaje: `${entrada.breakersAbiertos} números tienen los envíos en pausa por fallos.`,
      });
    } else if (entrada.breakersAbiertos === 1) {
      salida.push({
        nivel: 'aviso',
        codigo: 'numero-abierto',
        mensaje: 'Un número tiene los envíos en pausa por fallos seguidos.',
      });
    }
    if (entrada.killSwitchActivo) {
      salida.push({
        nivel: 'grave',
        codigo: 'kill-switch',
        mensaje: 'El interruptor de emergencia está activo.',
      });
    }
    if (entrada.ejecucionesEnAtencion >= 10) {
      salida.push({
        nivel: 'aviso',
        codigo: 'muchas-en-atencion',
        mensaje: `${entrada.ejecucionesEnAtencion} ejecuciones esperan que alguien las revise.`,
      });
    }
    if (entrada.trabajosDiferidos >= 500) {
      salida.push({
        nivel: 'aviso',
        codigo: 'cola-acumulada',
        mensaje: `${entrada.trabajosDiferidos} trabajos esperando en la cola.`,
      });
    }

    const contadores = this.foto().contadores;
    if (contadores['meta.429'] >= 20) {
      salida.push({
        nivel: 'aviso',
        codigo: 'muchos-429',
        mensaje: 'WhatsApp está rechazando envíos por exceso de frecuencia.',
      });
    }
    if (contadores['meta.timeoutAmbiguo'] >= 5) {
      salida.push({
        nivel: 'aviso',
        codigo: 'timeouts-ambiguos',
        mensaje:
          'Varios envíos quedaron sin confirmar. Hay que revisarlos antes de reintentar.',
      });
    }

    return salida;
  }

  /** Para las pruebas: vuelve a empezar. */
  reiniciar(): void {
    this.valores.clear();
    this.msEnAbierto = 0;
    this.desde = new Date();
  }
}
