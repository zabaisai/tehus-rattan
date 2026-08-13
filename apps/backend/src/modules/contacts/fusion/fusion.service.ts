import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { isSamePhone } from '../../../common/phone/e164.util';
import {
  CAMPOS_ESCALARES,
  CampoComparado,
  CampoEscalar,
  CandidatoDeFusion,
  ContactoResumen,
  EleccionesFusion,
  Lado,
  NivelDeCoincidencia,
  RecuentoRelaciones,
  ResultadoFusion,
  VistaPreviaFusion,
  normalizarCorreo,
  normalizarTelefono,
  parejaOrdenada,
  unirSinDuplicados,
} from './fusion.tipos';

/** Ventana para deshacer. Diez minutos, como promete la pantalla. */
export const MINUTOS_PARA_DESHACER = 10;

/**
 * Las relaciones que cuelgan de un contacto por `contactId`, verificadas contra
 * el esquema y no supuestas. Cambiar esta lista es lo único que hace falta
 * cuando aparezca una relación nueva: el traslado, el recuento, el snapshot y
 * la reversión la recorren entera.
 *
 * `Note` NO está: las notas cuelgan de la oportunidad o de la conversación, así
 * que viajan solas cuando viajan estas. Se cuentan aparte para poder enseñarlas.
 */
const RELACIONES = [
  { clave: 'conversaciones', modelo: 'conversation' },
  { clave: 'oportunidades', modelo: 'lead' },
  { clave: 'tareas', modelo: 'task' },
  { clave: 'sugerenciasDeTarea', modelo: 'taskSuggestion' },
  { clave: 'cotizaciones', modelo: 'quote' },
  { clave: 'ejecucionesDeBot', modelo: 'flowBotExecution' },
] as const;

interface SnapshotFusion {
  principalAntes: {
    name: string | null;
    phone: string;
    email: string | null;
    tags: string[];
    altPhones: string[];
    altEmails: string[];
  };
  duplicadoAntes: { phone: string };
  /** Versiones que dejó la propia fusión: si cambian, deshacer no es seguro. */
  versionesDespues: { principal: string; duplicado: string };
  trasladadas: Record<string, string[]>;
  /** Valores de campos personalizados que perdieron y se borraron. */
  camposPersonalizadosBorrados: Array<Record<string, unknown>>;
  /** Campos personalizados del principal que se pisaron con el valor del otro. */
  camposPersonalizadosPisados: Array<Record<string, unknown>>;
  /** Alias que apuntaban al duplicado y se reapuntaron al principal. */
  aliasReapuntados: string[];
  /**
   * Lo que se movió, contado en el momento de moverlo.
   *
   * Los mensajes y las notas no tienen `contactId`: viajan colgados de su
   * conversación o de su oportunidad. Contarlos aquí es la única forma de que
   * el resultado pueda decir cuántos se conservaron sin volver a consultarlos
   * después, cuando ya cuelgan del principal y no se distinguen de los suyos.
   */
  recuento: RecuentoRelaciones;
}

const SELECCION_CONTACTO = {
  id: true,
  name: true,
  phone: true,
  email: true,
  tags: true,
  altPhones: true,
  altEmails: true,
  archivedAt: true,
  anonymizedAt: true,
  createdAt: true,
  updatedAt: true,
  mergedIntoId: true,
  companyId: true,
} as const;

@Injectable()
export class FusionContactosService {
  constructor(private prisma: PrismaService) {}

  // ──────────────────────────────────────────────────────────────────────
  // Resolución de alias
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Devuelve el contacto vivo al que corresponde un id, siguiendo el alias.
   *
   * Es lo que hace que un enlace repartido antes de la fusión siga llevando a
   * alguna parte. Sigue como máximo una salto porque el servicio impide crear
   * cadenas: al fusionar, los alias del absorbido se reapuntan al principal.
   * Aun así se recorre en bucle con tope, porque una cadena creada a mano en la
   * base no puede colgar el proceso.
   */
  async resolverCanonico(id: string, companyId: string) {
    const inicial = await this.prisma.contact.findFirst({
      where: { id, companyId },
      select: { id: true, mergedIntoId: true, mergedAt: true },
    });
    if (!inicial) throw new NotFoundException('Contacto no encontrado');
    let actual: {
      id: string;
      mergedIntoId: string | null;
      mergedAt: Date | null;
    } = inicial;

    const original = actual.id;
    const visitados = new Set<string>([actual.id]);
    let saltos = 0;

    while (actual.mergedIntoId && saltos < 10) {
      if (visitados.has(actual.mergedIntoId)) break;
      const siguiente = await this.prisma.contact.findFirst({
        where: { id: actual.mergedIntoId, companyId },
        select: { id: true, mergedIntoId: true, mergedAt: true },
      });
      if (!siguiente) break;
      visitados.add(siguiente.id);
      actual = siguiente;
      saltos += 1;
    }

    return {
      solicitado: original,
      canonicoId: actual.id,
      fueFusionado: actual.id !== original,
      fusionadoEn: actual.id !== original ? actual.mergedAt : null,
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Candidatos
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Posibles duplicados de un contacto.
   *
   * Teléfono o correo normalizados producen coincidencia FUERTE; el nombre solo
   * sugiere. Nunca se fusiona nada aquí: esto solo propone.
   */
  async candidatos(
    contactId: string,
    companyId: string,
  ): Promise<CandidatoDeFusion[]> {
    const base = await this.prisma.contact.findFirst({
      where: { id: contactId, companyId },
      select: SELECCION_CONTACTO,
    });
    if (!base) throw new NotFoundException('Contacto no encontrado');
    if (base.mergedIntoId) return [];

    const telefonos = new Set(
      [base.phone, ...base.altPhones]
        .map((p) => normalizarTelefono(p))
        .filter((p): p is string => Boolean(p)),
    );
    const correos = new Set(
      [base.email, ...base.altEmails]
        .map((c) => normalizarCorreo(c))
        .filter((c): c is string => Boolean(c)),
    );
    const nombre = (base.name ?? '').trim().toLowerCase();

    // Se traen los candidatos vivos de la empresa y se comparan en memoria por
    // FORMA CANÓNICA. Comparar en SQL exigiría normalizar en la base, que es
    // justo la duplicación de reglas que este repositorio evita.
    const otros = await this.prisma.contact.findMany({
      where: {
        companyId,
        id: { not: contactId },
        mergedIntoId: null,
        anonymizedAt: null,
      },
      select: SELECCION_CONTACTO,
      take: 500,
      orderBy: { updatedAt: 'desc' },
    });

    const descartes = await this.prisma.contactMergeDismissal.findMany({
      where: {
        companyId,
        OR: [{ contactAId: contactId }, { contactBId: contactId }],
      },
      select: { contactAId: true, contactBId: true },
    });
    const descartados = new Set(
      descartes.map((d) => `${d.contactAId}|${d.contactBId}`),
    );

    const salida: CandidatoDeFusion[] = [];
    for (const otro of otros) {
      const [a, b] = parejaOrdenada(contactId, otro.id);
      if (descartados.has(`${a}|${b}`)) continue;

      const razones: string[] = [];
      let nivel: NivelDeCoincidencia | null = null;

      const susTelefonos = [otro.phone, ...otro.altPhones]
        .map((p) => normalizarTelefono(p))
        .filter((p): p is string => Boolean(p));
      if (susTelefonos.some((p) => telefonos.has(p))) {
        nivel = 'alta';
        razones.push('Mismo teléfono');
      }

      const susCorreos = [otro.email, ...otro.altEmails]
        .map((c) => normalizarCorreo(c))
        .filter((c): c is string => Boolean(c));
      if (susCorreos.some((c) => correos.has(c))) {
        nivel = 'alta';
        razones.push('Mismo correo');
      }

      const suNombre = (otro.name ?? '').trim().toLowerCase();
      if (nombre && suNombre && this.nombresParecidos(nombre, suNombre)) {
        nivel = nivel ?? 'sugerida';
        razones.push('Nombre parecido');
      }

      if (nivel) salida.push({ contacto: this.aResumen(otro), nivel, razones });
    }

    // Las fuertes primero: son las únicas que justifican mirar la pantalla.
    return salida.sort((x, y) =>
      x.nivel === y.nivel ? 0 : x.nivel === 'alta' ? -1 : 1,
    );
  }

  /**
   * Nombres «parecidos» a efectos de SUGERIR, nunca de fusionar.
   *
   * Regla explícita y corta: uno contiene al otro, o comparten la primera
   * palabra y la inicial de la segunda («Laura Martínez» y «Laura M.»). No se
   * mete distancia de edición: con nombres cortos produce parejas absurdas y
   * aquí un falso positivo le cuesta tiempo a una persona.
   */
  private nombresParecidos(a: string, b: string): boolean {
    if (a === b) return true;
    if (a.includes(b) || b.includes(a)) return true;
    const pa = a.split(/\s+/).filter(Boolean);
    const pb = b.split(/\s+/).filter(Boolean);
    if (pa.length < 2 || pb.length < 2) return false;
    return pa[0] === pb[0] && pa[1][0] === pb[1][0];
  }

  // ──────────────────────────────────────────────────────────────────────
  // Vista previa
  // ──────────────────────────────────────────────────────────────────────

  async comparar(
    principalId: string,
    duplicadoId: string,
    companyId: string,
  ): Promise<VistaPreviaFusion> {
    const { principal, duplicado } = await this.cargarPareja(
      this.prisma,
      principalId,
      duplicadoId,
      companyId,
    );

    if (principal.mergedIntoId)
      throw new ConflictException({
        codigo: 'PRINCIPAL_ES_ALIAS',
        mensaje:
          'Ese contacto ya fue fusionado dentro de otro: no puede ser el principal.',
      });
    if (duplicado.mergedIntoId)
      throw new ConflictException({
        codigo: 'YA_FUSIONADO',
        mensaje: 'Ese contacto ya fue fusionado dentro de otro.',
      });

    const campos = CAMPOS_ESCALARES.map((campo) =>
      this.compararCampo(campo, principal, duplicado),
    );

    const { comparados: camposPersonalizados } =
      await this.compararCamposPersonalizados(
        this.prisma,
        principal.id,
        duplicado.id,
        companyId,
      );

    const relaciones = await this.contarRelaciones(
      this.prisma,
      duplicado.id,
      companyId,
    );

    const razones: string[] = [];
    let nivel: NivelDeCoincidencia = 'sugerida';
    if (
      [duplicado.phone, ...duplicado.altPhones].some((p) =>
        [principal.phone, ...principal.altPhones].some((q) =>
          isSamePhone(p, q),
        ),
      )
    ) {
      nivel = 'alta';
      razones.push('Mismo teléfono');
    }
    const correosP = new Set(
      [principal.email, ...principal.altEmails]
        .map(normalizarCorreo)
        .filter(Boolean),
    );
    if (
      [duplicado.email, ...duplicado.altEmails]
        .map(normalizarCorreo)
        .some((c) => c && correosP.has(c))
    ) {
      nivel = 'alta';
      razones.push('Mismo correo');
    }
    if (
      (principal.name ?? '').trim() &&
      (duplicado.name ?? '').trim() &&
      this.nombresParecidos(
        principal.name!.trim().toLowerCase(),
        duplicado.name!.trim().toLowerCase(),
      )
    )
      razones.push('Nombre parecido');

    const alternativas = this.calcularAlternativas(principal, duplicado, {});

    return {
      principal: this.aResumen(principal),
      duplicado: this.aResumen(duplicado),
      coincidencia: { nivel, razones },
      campos,
      camposPersonalizados,
      etiquetas: {
        principal: principal.tags,
        duplicado: duplicado.tags,
        union: unirSinDuplicados(principal.tags, duplicado.tags),
      },
      identidadesAlternativas: alternativas,
      relaciones,
      versiones: {
        principal: principal.updatedAt.toISOString(),
        duplicado: duplicado.updatedAt.toISOString(),
      },
      decisionesPendientes: [...campos, ...camposPersonalizados].filter(
        (c) => c.requiereDecision,
      ).length,
    };
  }

  private compararCampo(
    campo: CampoEscalar,
    principal: any,
    duplicado: any,
  ): CampoComparado {
    const etiquetas: Record<CampoEscalar, string> = {
      name: 'Nombre',
      phone: 'Teléfono',
      email: 'Correo',
    };
    const vp: string | null = principal[campo] ?? null;
    const vd: string | null = duplicado[campo] ?? null;

    let iguales = (vp ?? '') === (vd ?? '');
    let nota: string | undefined;
    if (!iguales && campo === 'phone' && isSamePhone(vp, vd)) {
      iguales = true;
      nota = 'Mismo número en formato E.164';
    }
    if (!iguales && campo === 'email' && vp && vd) {
      if (normalizarCorreo(vp) === normalizarCorreo(vd)) {
        iguales = true;
        nota = 'Mismo correo con otra escritura';
      }
    }

    return {
      campo,
      etiqueta: etiquetas[campo],
      valorPrincipal: vp,
      valorDuplicado: vd,
      iguales,
      sugerido: 'principal',
      requiereDecision: !iguales && Boolean(vp) && Boolean(vd),
      ...(nota ? { nota } : {}),
    };
  }

  private async compararCamposPersonalizados(
    db: any,
    principalId: string,
    duplicadoId: string,
    companyId: string,
  ) {
    const valores = await db.customFieldValue.findMany({
      where: { companyId, contactId: { in: [principalId, duplicadoId] } },
      include: { definition: { select: { id: true, label: true, key: true } } },
    });

    const porDefinicion = new Map<string, { p?: any; d?: any; def: any }>();
    for (const v of valores) {
      const entrada = porDefinicion.get(v.definitionId) ?? {
        def: v.definition,
      };
      if (v.contactId === principalId) entrada.p = v;
      else entrada.d = v;
      porDefinicion.set(v.definitionId, entrada);
    }

    const comparados: CampoComparado[] = [];
    for (const [definitionId, { p, d, def }] of porDefinicion) {
      const vp = this.textoDeValor(p);
      const vd = this.textoDeValor(d);
      const iguales = vp === vd;
      comparados.push({
        campo: definitionId,
        etiqueta: def?.label ?? def?.key ?? 'Campo personalizado',
        valorPrincipal: vp,
        valorDuplicado: vd,
        iguales,
        sugerido: 'principal',
        requiereDecision: !iguales && Boolean(vp) && Boolean(vd),
      });
    }

    return { comparados, valores };
  }

  /** Texto legible de un valor de campo personalizado, sea del tipo que sea. */
  private textoDeValor(v: any): string | null {
    if (!v) return null;
    if (v.valueText != null && v.valueText !== '') return String(v.valueText);
    if (v.valueNumber != null) return String(v.valueNumber);
    if (v.valueBool != null) return v.valueBool ? 'Sí' : 'No';
    if (v.valueDate != null) return new Date(v.valueDate).toISOString();
    if (Array.isArray(v.valueList) && v.valueList.length)
      return v.valueList.join(', ');
    return null;
  }

  private calcularAlternativas(
    principal: any,
    duplicado: any,
    elecciones: EleccionesFusion,
  ) {
    const conservar = elecciones.conservarAlternativas !== false;
    if (!conservar) return { telefonos: [], correos: [] };

    const ladoTel = elecciones.campos?.phone ?? 'principal';
    const ladoCorreo = elecciones.campos?.email ?? 'principal';

    const telGanador =
      ladoTel === 'duplicado' ? duplicado.phone : principal.phone;
    const telPerdedor =
      ladoTel === 'duplicado' ? principal.phone : duplicado.phone;

    const correoGanador =
      ladoCorreo === 'duplicado' ? duplicado.email : principal.email;
    const correoPerdedor =
      ladoCorreo === 'duplicado' ? principal.email : duplicado.email;

    const telefonos = unirSinDuplicados(
      principal.altPhones,
      duplicado.altPhones,
      [telPerdedor].filter(Boolean) as string[],
    )
      .map((t) => normalizarTelefono(t) ?? t.trim())
      .filter((t) => t && !isSamePhone(t, telGanador));

    const correos = unirSinDuplicados(
      principal.altEmails,
      duplicado.altEmails,
      [correoPerdedor].filter(Boolean) as string[],
    )
      .map((c) => normalizarCorreo(c) ?? c.trim().toLowerCase())
      .filter((c) => c && c !== normalizarCorreo(correoGanador));

    return {
      telefonos: unirSinDuplicados(telefonos),
      correos: unirSinDuplicados(correos),
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Descartar una pareja
  // ──────────────────────────────────────────────────────────────────────

  async descartar(
    aId: string,
    bId: string,
    companyId: string,
    usuarioId: string,
  ) {
    if (aId === bId)
      throw new BadRequestException('Hay que indicar dos contactos distintos');
    await this.cargarPareja(this.prisma, aId, bId, companyId);
    const [contactAId, contactBId] = parejaOrdenada(aId, bId);

    // Repetir el descarte no es un error: el resultado buscado ya está.
    const existente = await this.prisma.contactMergeDismissal.findFirst({
      where: { companyId, contactAId, contactBId },
      select: { id: true, dismissedAt: true },
    });
    if (existente) return { descartado: true, nuevo: false, ...existente };

    const creado = await this.prisma.contactMergeDismissal.create({
      data: {
        companyId,
        contactAId,
        contactBId,
        dismissedById: usuarioId,
      },
      select: { id: true, dismissedAt: true },
    });
    return { descartado: true, nuevo: true, ...creado };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Fusión
  // ──────────────────────────────────────────────────────────────────────

  async fusionar(entrada: {
    companyId: string;
    usuarioId: string;
    principalId: string;
    duplicadoId: string;
    elecciones: EleccionesFusion;
    versiones: { principal: string; duplicado: string };
  }): Promise<ResultadoFusion> {
    const { companyId, principalId, duplicadoId } = entrada;

    if (principalId === duplicadoId)
      throw new BadRequestException(
        'Un contacto no se puede fusionar consigo mismo',
      );

    // Idempotencia ANTES de abrir la transacción: repetir la misma petición
    // devuelve el mismo resultado en vez de un conflicto.
    const previa = await this.prisma.contactMerge.findFirst({
      where: { companyId, mergedContactId: duplicadoId, undoneAt: null },
    });
    if (previa) {
      if (previa.primaryContactId !== principalId)
        throw new ConflictException({
          codigo: 'YA_FUSIONADO',
          mensaje: 'Ese contacto ya fue fusionado dentro de otro distinto.',
        });
      return this.aResultado(previa);
    }

    try {
      return await this.prisma.$transaction(async (tx) =>
        this.ejecutarFusion(tx, entrada),
      );
    } catch (e: any) {
      // Dos fusiones a la vez sobre el mismo duplicado: la única que llega
      // segunda choca con el índice único de `contact_merges`.
      if (e?.code === 'P2002')
        throw new ConflictException({
          codigo: 'FUSION_CONCURRENTE',
          mensaje:
            'Otra fusión sobre este contacto se completó primero. Vuelve a revisar.',
        });
      throw e;
    }
  }

  private async ejecutarFusion(
    tx: Prisma.TransactionClient,
    entrada: {
      companyId: string;
      usuarioId: string;
      principalId: string;
      duplicadoId: string;
      elecciones: EleccionesFusion;
      versiones: { principal: string; duplicado: string };
    },
  ): Promise<ResultadoFusion> {
    const { companyId, usuarioId, principalId, duplicadoId, elecciones } =
      entrada;

    const { principal, duplicado } = await this.cargarPareja(
      tx,
      principalId,
      duplicadoId,
      companyId,
    );

    // Se cuenta ANTES de mover: después las filas del duplicado ya cuelgan del
    // principal y no hay forma de distinguir cuáles vinieron de dónde.
    const recuento = await this.contarRelaciones(tx, duplicado.id, companyId);

    if (principal.mergedIntoId)
      throw new ConflictException({
        codigo: 'PRINCIPAL_ES_ALIAS',
        mensaje:
          'Ese contacto ya fue fusionado dentro de otro: no puede ser el principal.',
      });
    if (duplicado.mergedIntoId)
      throw new ConflictException({
        codigo: 'YA_FUSIONADO',
        mensaje: 'Ese contacto ya fue fusionado dentro de otro.',
      });
    if (principal.anonymizedAt || duplicado.anonymizedAt)
      throw new ConflictException({
        codigo: 'CONTACTO_ANONIMIZADO',
        mensaje:
          'Un contacto anonimizado por una solicitud de datos no se puede fusionar.',
      });

    // La vista previa y la ejecución tienen que hablar del mismo dato.
    if (
      entrada.versiones.principal !== principal.updatedAt.toISOString() ||
      entrada.versiones.duplicado !== duplicado.updatedAt.toISOString()
    )
      throw new ConflictException({
        codigo: 'VISTA_PREVIA_OBSOLETA',
        mensaje:
          'Uno de los contactos cambió desde que se preparó la comparación. Revísala otra vez.',
      });

    const ladoTel: Lado = elecciones.campos?.phone ?? 'principal';
    const intercambiaTelefono =
      ladoTel === 'duplicado' && principal.phone !== duplicado.phone;
    const telefonoFinal =
      ladoTel === 'duplicado' ? duplicado.phone : principal.phone;
    const tokenTemporal = `__fusion_${duplicado.id}`;

    // ── 1. Se reclama el duplicado con bloqueo optimista.
    //
    // `updateMany` condicionado por `updatedAt` y `mergedIntoId: null` es el
    // candado: si alguien lo tocó o lo fusionó entre la vista previa y ahora,
    // el contador vuelve 0 y no se escribe nada más.
    const reclamado = await tx.contact.updateMany({
      where: {
        id: duplicado.id,
        companyId,
        mergedIntoId: null,
        updatedAt: duplicado.updatedAt,
      },
      data: {
        mergedIntoId: principal.id,
        mergedAt: new Date(),
        // Liberar el número ANTES de dárselo al principal: `phone` es único
        // por empresa y las dos filas siguen existiendo.
        ...(intercambiaTelefono ? { phone: tokenTemporal } : {}),
      },
    });
    if (reclamado.count !== 1)
      throw new ConflictException({
        codigo: 'VISTA_PREVIA_OBSOLETA',
        mensaje:
          'El posible duplicado cambió mientras se preparaba la fusión. Revísala otra vez.',
      });

    // ── 2. Campos elegidos sobre el principal, también con bloqueo optimista.
    const alternativas = this.calcularAlternativas(
      principal,
      duplicado,
      elecciones,
    );
    const nombreFinal =
      (elecciones.campos?.name ?? 'principal') === 'duplicado'
        ? duplicado.name
        : (principal.name ?? duplicado.name);
    const correoFinal =
      (elecciones.campos?.email ?? 'principal') === 'duplicado'
        ? duplicado.email
        : (principal.email ?? duplicado.email);

    const actualizado = await tx.contact.updateMany({
      where: { id: principal.id, companyId, updatedAt: principal.updatedAt },
      data: {
        name: nombreFinal,
        email: correoFinal,
        phone: telefonoFinal,
        tags: unirSinDuplicados(principal.tags, duplicado.tags),
        altPhones: alternativas.telefonos,
        altEmails: alternativas.correos,
      },
    });
    if (actualizado.count !== 1)
      throw new ConflictException({
        codigo: 'VISTA_PREVIA_OBSOLETA',
        mensaje:
          'El contacto principal cambió mientras se preparaba la fusión. Revísala otra vez.',
      });

    // ── 3. Se cierra el intercambio de teléfono.
    if (intercambiaTelefono)
      await tx.contact.updateMany({
        where: { id: duplicado.id, companyId, phone: tokenTemporal },
        data: { phone: principal.phone },
      });

    // ── 4. Relaciones. Se capturan los ids ANTES de moverlos: son los que
    // permiten devolverlos exactamente a su sitio si se deshace.
    const trasladadas: Record<string, string[]> = {};
    for (const { clave, modelo } of RELACIONES) {
      const filas = await (tx as any)[modelo].findMany({
        where: { contactId: duplicado.id, companyId },
        select: { id: true },
      });
      trasladadas[clave] = filas.map((f: any) => f.id);
      if (filas.length)
        await (tx as any)[modelo].updateMany({
          where: { contactId: duplicado.id, companyId },
          data: { contactId: principal.id },
        });
    }

    // ── 5. Campos personalizados: no se trasladan a ciegas.
    //
    // `@@unique([definitionId, contactId])` impide que el principal tenga dos
    // valores del mismo campo, así que cada definición se resuelve con la
    // elección de la persona y el valor perdedor se guarda en el snapshot
    // antes de desaparecer.
    const { camposPersonalizadosBorrados, camposPersonalizadosPisados } =
      await this.resolverCamposPersonalizados(
        tx,
        principal.id,
        duplicado.id,
        companyId,
        elecciones,
      );
    trasladadas.camposPersonalizados = camposPersonalizadosBorrados.map((c) =>
      String(c.id),
    );

    // ── 6. Alias que apuntaban al duplicado pasan a apuntar al principal.
    // Sin esto quedaría una cadena A → B → C, y resolver un enlace antiguo
    // dependería de cuántos saltos se den.
    const aliasPrevios = await tx.contact.findMany({
      where: { companyId, mergedIntoId: duplicado.id },
      select: { id: true },
    });
    if (aliasPrevios.length)
      await tx.contact.updateMany({
        where: { companyId, mergedIntoId: duplicado.id },
        data: { mergedIntoId: principal.id },
      });

    // ── 7. Se descarta la sugerencia: ya no son dos.
    const [a, b] = parejaOrdenada(principal.id, duplicado.id);
    await tx.contactMergeDismissal.deleteMany({
      where: { companyId, contactAId: a, contactBId: b },
    });

    const [principalDespues, duplicadoDespues] = await Promise.all([
      tx.contact.findFirst({
        where: { id: principal.id, companyId },
        select: { updatedAt: true },
      }),
      tx.contact.findFirst({
        where: { id: duplicado.id, companyId },
        select: { updatedAt: true },
      }),
    ]);

    const snapshot: SnapshotFusion = {
      principalAntes: {
        name: principal.name,
        phone: principal.phone,
        email: principal.email,
        tags: principal.tags,
        altPhones: principal.altPhones,
        altEmails: principal.altEmails,
      },
      duplicadoAntes: { phone: duplicado.phone },
      versionesDespues: {
        principal: principalDespues!.updatedAt.toISOString(),
        duplicado: duplicadoDespues!.updatedAt.toISOString(),
      },
      trasladadas,
      camposPersonalizadosBorrados,
      camposPersonalizadosPisados,
      aliasReapuntados: aliasPrevios.map((x) => x.id),
      recuento,
    };

    const ahora = new Date();
    const merge = await tx.contactMerge.create({
      data: {
        companyId,
        primaryContactId: principal.id,
        mergedContactId: duplicado.id,
        performedById: usuarioId,
        performedAt: ahora,
        undoableUntil: new Date(
          ahora.getTime() + MINUTOS_PARA_DESHACER * 60_000,
        ),
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
    });

    return this.aResultado(merge);
  }

  private async resolverCamposPersonalizados(
    tx: Prisma.TransactionClient,
    principalId: string,
    duplicadoId: string,
    companyId: string,
    elecciones: EleccionesFusion,
  ) {
    const valores = await (tx as any).customFieldValue.findMany({
      where: { companyId, contactId: { in: [principalId, duplicadoId] } },
    });

    const porDefinicion = new Map<string, { p?: any; d?: any }>();
    for (const v of valores) {
      const e = porDefinicion.get(v.definitionId) ?? {};
      if (v.contactId === principalId) e.p = v;
      else e.d = v;
      porDefinicion.set(v.definitionId, e);
    }

    const camposPersonalizadosBorrados: Array<Record<string, unknown>> = [];
    const camposPersonalizadosPisados: Array<Record<string, unknown>> = [];

    for (const [definitionId, { p, d }] of porDefinicion) {
      if (!d) continue; // el duplicado no aporta nada: no hay que hacer nada
      const lado =
        elecciones.camposPersonalizados?.[definitionId] ?? 'principal';

      if (!p) {
        // El principal no tenía valor: la fila del duplicado se traslada tal
        // cual. No hay conflicto con el índice único.
        await (tx as any).customFieldValue.updateMany({
          where: { id: d.id, companyId },
          data: { contactId: principalId },
        });
        camposPersonalizadosBorrados.push({ id: d.id, trasladado: true });
        continue;
      }

      if (lado === 'duplicado') {
        camposPersonalizadosPisados.push(this.filaDeValor(p));
        await (tx as any).customFieldValue.updateMany({
          where: { id: p.id, companyId },
          data: {
            valueText: d.valueText,
            valueNumber: d.valueNumber,
            valueBool: d.valueBool,
            valueDate: d.valueDate,
            valueList: d.valueList,
          },
        });
      }
      // Gane quien gane, la fila del duplicado desaparece: el principal solo
      // puede tener una por definición. Se guarda entera para poder deshacer.
      camposPersonalizadosBorrados.push(this.filaDeValor(d));
      await (tx as any).customFieldValue.deleteMany({
        where: { id: d.id, companyId },
      });
    }

    return { camposPersonalizadosBorrados, camposPersonalizadosPisados };
  }

  private filaDeValor(v: any): Record<string, unknown> {
    return {
      id: v.id,
      definitionId: v.definitionId,
      companyId: v.companyId,
      contactId: v.contactId,
      valueText: v.valueText,
      valueNumber: v.valueNumber == null ? null : String(v.valueNumber),
      valueBool: v.valueBool,
      valueDate: v.valueDate ? new Date(v.valueDate).toISOString() : null,
      valueList: v.valueList ?? [],
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Deshacer
  // ──────────────────────────────────────────────────────────────────────

  async estado(mergeId: string, companyId: string): Promise<ResultadoFusion> {
    const merge = await this.prisma.contactMerge.findFirst({
      where: { id: mergeId, companyId },
    });
    if (!merge) throw new NotFoundException('Fusión no encontrada');
    return this.aResultado(merge);
  }

  /**
   * Deshace una fusión reciente, y solo si sigue siendo seguro.
   *
   * SEGURO significa que el mundo no se movió: ninguno de los dos contactos
   * cambió después de la fusión y todas las filas trasladadas siguen existiendo
   * y siguen colgando del principal. Si algo de eso falló, deshacer dejaría un
   * estado que nadie eligió —media conversación en un sitio y media en otro—,
   * así que se responde conflicto y se explica por qué.
   */
  async deshacer(mergeId: string, companyId: string, usuarioId: string) {
    return this.prisma.$transaction(async (tx) => {
      const merge = await tx.contactMerge.findFirst({
        where: { id: mergeId, companyId },
      });
      if (!merge) throw new NotFoundException('Fusión no encontrada');
      if (merge.undoneAt)
        throw new ConflictException({
          codigo: 'YA_DESHECHA',
          mensaje: 'Esta fusión ya se deshizo.',
        });
      if (merge.undoableUntil.getTime() < Date.now())
        throw new ConflictException({
          codigo: 'VENTANA_VENCIDA',
          mensaje:
            'La ventana de 10 minutos para deshacer esta fusión ya pasó.',
        });

      const snapshot = merge.snapshot as unknown as SnapshotFusion;

      const [principal, duplicado] = await Promise.all([
        tx.contact.findFirst({
          where: { id: merge.primaryContactId, companyId },
          select: SELECCION_CONTACTO,
        }),
        tx.contact.findFirst({
          where: { id: merge.mergedContactId, companyId },
          select: SELECCION_CONTACTO,
        }),
      ]);
      if (!principal || !duplicado)
        throw new ConflictException({
          codigo: 'REVERSION_INSEGURA',
          mensaje:
            'Uno de los dos contactos ya no existe: la fusión no se puede deshacer.',
        });

      if (
        principal.updatedAt.toISOString() !==
          snapshot.versionesDespues.principal ||
        duplicado.updatedAt.toISOString() !==
          snapshot.versionesDespues.duplicado
      )
        throw new ConflictException({
          codigo: 'REVERSION_INSEGURA',
          mensaje:
            'Alguno de los contactos cambió después de la fusión. Deshacerla ahora perdería ese cambio.',
        });

      // Todas las filas trasladadas tienen que seguir existiendo y colgando
      // del principal. Si una se borró o alguien la movió, la reversión ya no
      // devuelve el estado que se registró.
      for (const { clave, modelo } of RELACIONES) {
        const ids = snapshot.trasladadas[clave] ?? [];
        if (!ids.length) continue;
        const vivas = await (tx as any)[modelo].count({
          where: { id: { in: ids }, companyId, contactId: principal.id },
        });
        if (vivas !== ids.length)
          throw new ConflictException({
            codigo: 'REVERSION_INSEGURA',
            mensaje:
              'Algo que se trasladó en la fusión cambió después. Deshacerla dejaría datos a medias.',
            detalle: clave,
          });
      }

      // ── Devolver relaciones
      for (const { clave, modelo } of RELACIONES) {
        const ids = snapshot.trasladadas[clave] ?? [];
        if (!ids.length) continue;
        await (tx as any)[modelo].updateMany({
          where: { id: { in: ids }, companyId },
          data: { contactId: duplicado.id },
        });
      }

      // ── Campos personalizados: primero se repone lo que se pisó, después se
      // recrean las filas que se borraron.
      for (const pisado of snapshot.camposPersonalizadosPisados ?? []) {
        await (tx as any).customFieldValue.updateMany({
          where: { id: pisado.id as string, companyId },
          data: {
            valueText: pisado.valueText ?? null,
            valueNumber: (pisado.valueNumber as string | null) ?? null,
            valueBool: pisado.valueBool ?? null,
            valueDate: pisado.valueDate
              ? new Date(pisado.valueDate as string)
              : null,
            valueList: (pisado.valueList as string[]) ?? [],
          },
        });
      }
      for (const borrado of snapshot.camposPersonalizadosBorrados ?? []) {
        if (borrado.trasladado) {
          await (tx as any).customFieldValue.updateMany({
            where: { id: borrado.id as string, companyId },
            data: { contactId: duplicado.id },
          });
          continue;
        }
        await (tx as any).customFieldValue.create({
          data: {
            id: borrado.id as string,
            companyId,
            definitionId: borrado.definitionId as string,
            contactId: duplicado.id,
            valueText: (borrado.valueText as string) ?? null,
            valueNumber: (borrado.valueNumber as string | null) ?? null,
            valueBool: (borrado.valueBool as boolean) ?? null,
            valueDate: borrado.valueDate
              ? new Date(borrado.valueDate as string)
              : null,
            valueList: (borrado.valueList as string[]) ?? [],
          },
        });
      }

      // ── Alias reapuntados vuelven al duplicado.
      if (snapshot.aliasReapuntados?.length)
        await tx.contact.updateMany({
          where: { companyId, id: { in: snapshot.aliasReapuntados } },
          data: { mergedIntoId: duplicado.id },
        });

      // ── Escalares del principal y teléfono del duplicado.
      //
      // El teléfono se repone en dos pasos por lo mismo que en la fusión: es
      // único por empresa y las dos filas conviven.
      const tokenTemporal = `__deshacer_${duplicado.id}`;
      await tx.contact.updateMany({
        where: { id: duplicado.id, companyId },
        data: { phone: tokenTemporal, mergedIntoId: null, mergedAt: null },
      });
      await tx.contact.updateMany({
        where: { id: principal.id, companyId },
        data: {
          name: snapshot.principalAntes.name,
          phone: snapshot.principalAntes.phone,
          email: snapshot.principalAntes.email,
          tags: snapshot.principalAntes.tags,
          altPhones: snapshot.principalAntes.altPhones,
          altEmails: snapshot.principalAntes.altEmails,
        },
      });
      await tx.contact.updateMany({
        where: { id: duplicado.id, companyId, phone: tokenTemporal },
        data: { phone: snapshot.duplicadoAntes.phone },
      });

      const actualizado = await tx.contactMerge.update({
        where: { id: merge.id },
        data: { undoneAt: new Date(), undoneById: usuarioId },
      });

      return {
        deshecha: true,
        mergeId: actualizado.id,
        principalId: merge.primaryContactId,
        duplicadoId: merge.mergedContactId,
      };
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Utilidades
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Carga los dos contactos exigiendo empresa en la consulta.
   *
   * Un contacto de otra empresa responde «no encontrado», no «prohibido»: decir
   * que existe pero no se puede tocar ya es filtrar que existe.
   */
  private async cargarPareja(
    db: any,
    principalId: string,
    duplicadoId: string,
    companyId: string,
  ) {
    const filas = await db.contact.findMany({
      where: { id: { in: [principalId, duplicadoId] }, companyId },
      select: SELECCION_CONTACTO,
    });
    const principal = filas.find((c: any) => c.id === principalId);
    const duplicado = filas.find((c: any) => c.id === duplicadoId);
    if (!principal || !duplicado)
      throw new NotFoundException('Contacto no encontrado');
    return { principal, duplicado };
  }

  private async contarRelaciones(
    db: any,
    contactId: string,
    companyId: string,
  ): Promise<RecuentoRelaciones> {
    const [
      conversaciones,
      oportunidades,
      tareas,
      sugerenciasDeTarea,
      cotizaciones,
      ejecucionesDeBot,
      camposPersonalizados,
    ] = await Promise.all(
      [
        'conversation',
        'lead',
        'task',
        'taskSuggestion',
        'quote',
        'flowBotExecution',
        'customFieldValue',
      ].map((modelo) => db[modelo].count({ where: { contactId, companyId } })),
    );

    const [mensajes, notas] = await Promise.all([
      db.message.count({ where: { conversation: { contactId, companyId } } }),
      db.note.count({
        where: {
          companyId,
          OR: [{ lead: { contactId } }, { conversation: { contactId } }],
        },
      }),
    ]);

    return {
      conversaciones,
      mensajes,
      oportunidades,
      tareas,
      sugerenciasDeTarea,
      cotizaciones,
      camposPersonalizados,
      ejecucionesDeBot,
      notas,
    };
  }

  private aResumen(c: any): ContactoResumen {
    return {
      id: c.id,
      name: c.name ?? null,
      phone: c.phone,
      email: c.email ?? null,
      tags: c.tags ?? [],
      altPhones: c.altPhones ?? [],
      altEmails: c.altEmails ?? [],
      archivedAt: c.archivedAt ? new Date(c.archivedAt).toISOString() : null,
      createdAt: new Date(c.createdAt).toISOString(),
      updatedAt: new Date(c.updatedAt).toISOString(),
      mergedIntoId: c.mergedIntoId ?? null,
    };
  }

  private aResultado(merge: any): ResultadoFusion {
    const snapshot = (merge.snapshot ?? {}) as SnapshotFusion;
    const restante = Math.max(
      0,
      Math.floor((merge.undoableUntil.getTime() - Date.now()) / 1000),
    );
    return {
      mergeId: merge.id,
      principalId: merge.primaryContactId,
      duplicadoId: merge.mergedContactId,
      trasladadas: snapshot.recuento ?? {
        conversaciones: 0,
        mensajes: 0,
        oportunidades: 0,
        tareas: 0,
        sugerenciasDeTarea: 0,
        cotizaciones: 0,
        camposPersonalizados: 0,
        ejecucionesDeBot: 0,
        notas: 0,
      },
      realizadaEn: merge.performedAt.toISOString(),
      deshacerHasta: merge.undoableUntil.toISOString(),
      segundosRestantes: merge.undoneAt ? 0 : restante,
      deshecha: Boolean(merge.undoneAt),
    };
  }
}
