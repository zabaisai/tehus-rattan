import {
  Efectos,
  PuertoAuditoria,
  PuertoCrm,
  PuertoHttp,
  PuertoIa,
  PuertoMensajeria,
  PuertoReloj,
} from './flowbot.ports';

/**
 * Adaptadores falsos.
 *
 * SON LO QUE HACE INOCUO AL SIMULADOR. Registran la intención en vez de
 * ejecutarla: no hablan con Meta, no escriben en la base, no llaman a
 * servicios externos ni a proveedores de IA de pago.
 *
 * Que el motor solo conozca los puertos —y no Prisma ni el cliente de
 * WhatsApp— es lo que permite garantizarlo por construcción. «Modo
 * simulación» no es una bandera repartida por el código que alguien pueda
 * olvidar en un sitio: es un juego de implementaciones distinto.
 */

export interface EfectoRegistrado {
  puerto: 'mensajeria' | 'crm' | 'http' | 'ia' | 'auditoria';
  operacion: string;
  datos: Record<string, unknown>;
}

/** Reloj manejable: las pruebas adelantan el tiempo sin esperar de verdad. */
export class RelojFalso implements PuertoReloj {
  constructor(private instante: Date = new Date('2026-01-01T12:00:00.000Z')) {}

  ahora(): Date {
    return new Date(this.instante);
  }

  avanzar(ms: number): void {
    this.instante = new Date(this.instante.getTime() + ms);
  }

  fijar(fecha: Date): void {
    this.instante = new Date(fecha);
  }
}

export interface OpcionesFalsas {
  /** Si `false`, `dentroDeVentana` responde que no: fuerza el uso de plantilla. */
  dentroDeVentana?: boolean;
  /** Si `false`, los nodos de IA salen por su rama de reserva. */
  iaDisponible?: boolean;
  /** A quién devuelve el round-robin. `null` = nadie disponible. */
  siguienteEnTurno?: { userId: string; nombre: string } | null;
  /** Respuesta fija del clasificador, para pruebas deterministas. */
  clasificacion?: { eleccion: string | null; confianza: number };
}

/**
 * Juego completo de efectos falsos con registro de lo que se habría hecho.
 *
 * Los identificadores que devuelve son deterministas y llevan el prefijo
 * `sim-`: si uno acabara en la base por error, se reconoce a simple vista.
 */
export class EfectosFalsos implements Efectos {
  readonly registro: EfectoRegistrado[] = [];
  readonly reloj: RelojFalso;

  private contador = 0;
  /** Claves ya vistas: prueba que la idempotencia del motor funciona. */
  private readonly clavesUsadas = new Set<string>();

  constructor(private readonly opciones: OpcionesFalsas = {}) {
    this.reloj = new RelojFalso();
  }

  /** Cuántas veces se llamó a una operación. Para aserciones legibles. */
  vecesDe(operacion: string): number {
    return this.registro.filter((e) => e.operacion === operacion).length;
  }

  ultimo(operacion: string): Record<string, unknown> | undefined {
    return [...this.registro].reverse().find((e) => e.operacion === operacion)
      ?.datos;
  }

  /** Efectos repetidos con la misma clave: deben ser cero. */
  duplicados(): string[] {
    const vistas = new Set<string>();
    const repetidas: string[] = [];
    for (const e of this.registro) {
      const clave = e.datos.idempotencyKey;
      if (typeof clave !== 'string') continue;
      if (vistas.has(clave)) repetidas.push(clave);
      vistas.add(clave);
    }
    return repetidas;
  }

  private anotar(
    puerto: EfectoRegistrado['puerto'],
    operacion: string,
    datos: Record<string, unknown>,
  ): void {
    this.registro.push({ puerto, operacion, datos });
  }

  /**
   * Repite el resultado si la clave ya se usó, en vez de volver a «hacerlo».
   * Es lo que un adaptador real debe hacer, así que las pruebas ejercitan la
   * misma forma.
   */
  private unaVez<T>(clave: string, hacer: () => T): T {
    const nuevo = hacer();
    this.clavesUsadas.add(clave);
    return nuevo;
  }

  private id(prefijo: string): string {
    this.contador += 1;
    return `sim-${prefijo}-${this.contador}`;
  }

  // ── mensajería ──────────────────────────────────────────────
  readonly mensajeria: PuertoMensajeria = {
    enviarTexto: async (input) => {
      this.anotar('mensajeria', 'enviarTexto', { ...input });
      return this.unaVez(input.idempotencyKey, () => ({
        wamid: this.id('wamid'),
      }));
    },
    enviarPlantilla: async (input) => {
      this.anotar('mensajeria', 'enviarPlantilla', { ...input });
      return { wamid: this.id('wamid') };
    },
    enviarMedio: async (input) => {
      this.anotar('mensajeria', 'enviarMedio', { ...input });
      return { wamid: this.id('wamid') };
    },
    enviarOpciones: async (input) => {
      this.anotar('mensajeria', 'enviarOpciones', { ...input });
      return { wamid: this.id('wamid') };
    },
    dentroDeVentana: async () => this.opciones.dentroDeVentana ?? true,
  };

  // ── CRM ─────────────────────────────────────────────────────
  readonly crm: PuertoCrm = {
    guardarContacto: async (input) => {
      this.anotar('crm', 'guardarContacto', { ...input });
      return { contactId: input.contactId ?? this.id('contacto') };
    },
    etiquetar: async (input) => {
      this.anotar('crm', 'etiquetar', { ...input });
    },
    campoPersonalizado: async (input) => {
      this.anotar('crm', 'campoPersonalizado', { ...input });
    },
    crearOportunidad: async (input) => {
      this.anotar('crm', 'crearOportunidad', { ...input });
      return { leadId: this.id('lead') };
    },
    moverEtapa: async (input) => {
      this.anotar('crm', 'moverEtapa', { ...input });
    },
    valorOportunidad: async (input) => {
      this.anotar('crm', 'valorOportunidad', { ...input });
    },
    asignar: async (input) => {
      this.anotar('crm', 'asignar', { ...input });
    },
    siguienteEnTurno: async (input) => {
      this.anotar('crm', 'siguienteEnTurno', { ...input });
      return this.opciones.siguienteEnTurno === undefined
        ? { userId: 'sim-asesor-1', nombre: 'Asesor de prueba' }
        : this.opciones.siguienteEnTurno;
    },
    cerrarOportunidad: async (input) => {
      this.anotar('crm', 'cerrarOportunidad', { ...input });
    },
    crearTarea: async (input) => {
      this.anotar('crm', 'crearTarea', { ...input });
      return { taskId: this.id('tarea') };
    },
    notaInterna: async (input) => {
      this.anotar('crm', 'notaInterna', { ...input });
    },
    cerrarConversacion: async (input) => {
      this.anotar('crm', 'cerrarConversacion', { ...input });
    },
    reabrirConversacion: async (input) => {
      this.anotar('crm', 'reabrirConversacion', { ...input });
    },
    transferir: async (input) => {
      this.anotar('crm', 'transferir', { ...input });
    },
  };

  // ── HTTP ────────────────────────────────────────────────────
  readonly http: PuertoHttp = {
    llamar: async (input) => {
      // NUNCA sale a la red. Si una prueba esperase una respuesta concreta,
      // tendría que declararla; devolver algo plausible sin decirlo llevaría a
      // pruebas que pasan por casualidad.
      this.anotar('http', 'llamar', {
        companyId: input.companyId,
        url: input.url,
        metodo: input.metodo,
        // Las cabeceras pueden llevar credenciales: solo se anotan sus nombres.
        cabeceras: Object.keys(input.cabeceras ?? {}),
        credentialId: input.credentialId,
      });
      return { estado: 200, datos: { simulado: true } };
    },
  };

  // ── IA ──────────────────────────────────────────────────────
  readonly ia: PuertoIa = {
    disponible: async () => this.opciones.iaDisponible ?? false,
    clasificar: async (input) => {
      this.anotar('ia', 'clasificar', {
        companyId: input.companyId,
        opciones: input.opciones,
      });
      return this.opciones.clasificacion ?? { eleccion: null, confianza: 0 };
    },
    extraer: async (input) => {
      this.anotar('ia', 'extraer', {
        companyId: input.companyId,
        campos: input.campos,
      });
      return {};
    },
    redactar: async (input) => {
      this.anotar('ia', 'redactar', { companyId: input.companyId });
      return '(respuesta simulada)';
    },
    resumir: async (input) => {
      this.anotar('ia', 'resumir', { companyId: input.companyId });
      return '(resumen simulado)';
    },
  };

  // ── auditoría ───────────────────────────────────────────────
  readonly auditoria: PuertoAuditoria = {
    registrar: async (input) => {
      this.anotar('auditoria', 'registrar', { ...input });
    },
  };
}
