import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CustomFieldEntity,
  CustomFieldSource,
  CustomFieldType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CLAVE_VALIDA,
  claveDesdeEtiqueta,
  comoCadena,
  leerOpciones,
  normalizar,
  ValorNormalizado,
} from './custom-fields.types';

/**
 * Campos personalizados por empresa.
 *
 * REGLA CENTRAL: el `companyId` va SIEMPRE dentro del `where`, nunca en una
 * comprobación posterior. Una definición o un valor de otra empresa no se
 * traen para descartarlos después; simplemente no se encuentran. Es la misma
 * disciplina que el resto del CRM y la razón por la que un flujo de una
 * empresa no puede leer ni escribir los campos de otra.
 *
 * LA CLAVE (`key`) ES LA REFERENCIA ESTABLE, no la etiqueta. Renombrar
 * "Cédula" a "Documento" no puede romper los bots que escriben ahí.
 */

export interface EntradaDefinicion {
  entity: CustomFieldEntity;
  key?: string;
  label: string;
  type: CustomFieldType;
  helpText?: string | null;
  options?: unknown;
  validation?: unknown;
  order?: number;
  isActive?: boolean;
  isRequired?: boolean;
}

export interface DestinoValor {
  contactId?: string | null;
  leadId?: string | null;
}

export interface OrigenCambio {
  source: CustomFieldSource;
  actorUserId?: string | null;
  executionId?: string | null;
}

export interface ValorLegible {
  key: string;
  label: string;
  type: CustomFieldType;
  valor: string | null;
  crudo: unknown;
}

/** Tope de definiciones por empresa y entidad. */
export const MAX_DEFINICIONES = 200;

@Injectable()
export class CustomFieldsService {
  private readonly logger = new Logger(CustomFieldsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── definiciones ────────────────────────────────────────────

  async listarDefiniciones(
    companyId: string,
    entity?: CustomFieldEntity,
    incluirInactivas = false,
  ) {
    return this.prisma.customFieldDefinition.findMany({
      where: {
        companyId,
        ...(entity ? { entity } : {}),
        ...(incluirInactivas ? {} : { isActive: true }),
      },
      orderBy: [{ entity: 'asc' }, { order: 'asc' }, { label: 'asc' }],
    });
  }

  /**
   * Crea una definición.
   *
   * La clave se deriva de la etiqueta si no la dan, pero una vez creada NO se
   * puede cambiar: cambiarla dejaría huérfanos todos los valores capturados y
   * todos los flujos que apuntan a ella.
   */
  async crearDefinicion(companyId: string, entrada: EntradaDefinicion) {
    const key = (entrada.key ?? claveDesdeEtiqueta(entrada.label)).trim();
    if (!CLAVE_VALIDA.test(key)) {
      throw new BadRequestException(
        'La clave debe empezar por letra y llevar solo minúsculas, números y guion bajo',
      );
    }
    if (!entrada.label?.trim()) {
      throw new BadRequestException('La etiqueta no puede estar vacía');
    }

    const cuantas = await this.prisma.customFieldDefinition.count({
      where: { companyId, entity: entrada.entity },
    });
    if (cuantas >= MAX_DEFINICIONES) {
      throw new BadRequestException(
        `No se pueden crear más de ${MAX_DEFINICIONES} campos por entidad`,
      );
    }

    const options = this.validarOpciones(entrada.type, entrada.options);

    try {
      return await this.prisma.customFieldDefinition.create({
        data: {
          companyId,
          entity: entrada.entity,
          key,
          label: entrada.label.trim(),
          type: entrada.type,
          helpText: entrada.helpText?.trim() || null,
          options: options ?? Prisma.DbNull,
          validation:
            (entrada.validation as Prisma.InputJsonValue) ?? Prisma.DbNull,
          order: entrada.order ?? 0,
          isActive: entrada.isActive ?? true,
          isRequired: entrada.isRequired ?? false,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException(
          `Ya existe un campo con la clave "${key}" para esa entidad`,
        );
      }
      throw error;
    }
  }

  /**
   * Actualiza una definición. NO deja cambiar `key`, `entity` ni `type`.
   *
   * El tipo es inmutable porque los valores ya están escritos en la columna
   * que le corresponde: cambiar TEXT a NUMBER dejaría los datos existentes en
   * `valueText` y las lecturas nuevas mirando `valueNumber`, así que el campo
   * parecería vacío para todos los clientes anteriores. Para cambiar de tipo
   * se crea un campo nuevo y se migran los valores a conciencia.
   */
  async actualizarDefinicion(
    companyId: string,
    id: string,
    cambios: Partial<Omit<EntradaDefinicion, 'entity' | 'key' | 'type'>>,
  ) {
    const actual = await this.prisma.customFieldDefinition.findFirst({
      where: { id, companyId },
    });
    if (!actual) throw new NotFoundException('Campo no encontrado');

    const options =
      cambios.options === undefined
        ? undefined
        : this.validarOpciones(actual.type, cambios.options);

    const { count } = await this.prisma.customFieldDefinition.updateMany({
      where: { id, companyId },
      data: {
        ...(cambios.label !== undefined ? { label: cambios.label.trim() } : {}),
        ...(cambios.helpText !== undefined
          ? { helpText: cambios.helpText?.trim() || null }
          : {}),
        ...(options !== undefined ? { options: options ?? Prisma.DbNull } : {}),
        ...(cambios.validation !== undefined
          ? {
              validation:
                (cambios.validation as Prisma.InputJsonValue) ?? Prisma.DbNull,
            }
          : {}),
        ...(cambios.order !== undefined ? { order: cambios.order } : {}),
        ...(cambios.isActive !== undefined
          ? { isActive: cambios.isActive }
          : {}),
        ...(cambios.isRequired !== undefined
          ? { isRequired: cambios.isRequired }
          : {}),
      },
    });
    if (count === 0) throw new NotFoundException('Campo no encontrado');

    return this.prisma.customFieldDefinition.findFirst({
      where: { id, companyId },
    });
  }

  /**
   * Desactiva un campo. NO lo borra.
   *
   * Los valores capturados son datos del cliente: borrarlos porque alguien
   * retira el campo del formulario es destruir información que quizá haga
   * falta para responder una reclamación.
   */
  async desactivarDefinicion(companyId: string, id: string) {
    const { count } = await this.prisma.customFieldDefinition.updateMany({
      where: { id, companyId },
      data: { isActive: false },
    });
    if (count === 0) throw new NotFoundException('Campo no encontrado');
    return { desactivado: true };
  }

  private validarOpciones(
    tipo: CustomFieldType,
    options: unknown,
  ): Prisma.InputJsonValue | null {
    if (tipo !== 'SELECT' && tipo !== 'MULTI_SELECT') return null;

    const limpias = leerOpciones(options);
    if (limpias.length === 0) {
      throw new BadRequestException(
        'Un campo de selección necesita al menos una opción',
      );
    }
    if (limpias.length > 200) {
      throw new BadRequestException('Demasiadas opciones');
    }
    const vistos = new Set<string>();
    for (const o of limpias) {
      if (vistos.has(o.value)) {
        throw new BadRequestException(`Opción repetida: "${o.value}"`);
      }
      vistos.add(o.value);
    }
    return limpias as unknown as Prisma.InputJsonValue;
  }

  // ── valores ─────────────────────────────────────────────────

  /**
   * Escribe un valor por CLAVE.
   *
   * Es el camino que usa el motor de bots: un nodo dice «guarda en
   * `estado_credito`», no conoce ids. Devuelve el resultado en vez de lanzar
   * para los casos previsibles —campo inexistente, valor inválido— porque el
   * motor necesita clasificarlos y decidir si reintenta o pide atención
   * humana, y una excepción se lo pondría todo en el mismo saco.
   */
  async establecerPorClave(input: {
    companyId: string;
    entity: CustomFieldEntity;
    key: string;
    valor: unknown;
    destino: DestinoValor;
    origen: OrigenCambio;
  }): Promise<
    | { ok: true; cambiado: boolean; definitionId: string }
    | {
        ok: false;
        motivo: string;
        clase: 'campo-inexistente' | 'valor-invalido';
      }
  > {
    const definicion = await this.prisma.customFieldDefinition.findFirst({
      where: {
        companyId: input.companyId,
        entity: input.entity,
        key: input.key,
        isActive: true,
      },
    });
    if (!definicion) {
      // No se crea sobre la marcha. Un campo que aparece porque un bot lo
      // mencionó llena el CRM de columnas fantasma con erratas por nombre.
      return {
        ok: false,
        clase: 'campo-inexistente',
        motivo: `No existe un campo activo "${input.key}" para ${input.entity}`,
      };
    }

    const validado = normalizar(definicion, input.valor);
    if (!validado.ok) {
      return { ok: false, clase: 'valor-invalido', motivo: validado.motivo };
    }

    const cambiado = await this.escribir(
      input.companyId,
      definicion,
      validado.valor,
      input.destino,
      input.origen,
    );
    return { ok: true, cambiado, definitionId: definicion.id };
  }

  /**
   * Escribe el valor y anota el cambio si de verdad cambió.
   *
   * ANOTAR SOLO LOS CAMBIOS REALES es deliberado: un bot que reescribe el
   * mismo valor en cada mensaje llenaría el historial de ruido y haría
   * imposible encontrar el cambio que importa.
   */
  private async escribir(
    companyId: string,
    definicion: {
      id: string;
      type: CustomFieldType;
      entity: CustomFieldEntity;
    },
    valor: ValorNormalizado,
    destino: DestinoValor,
    origen: OrigenCambio,
  ): Promise<boolean> {
    const { contactId, leadId } = await this.destinoDeLaEmpresa(
      companyId,
      definicion.entity,
      destino,
    );

    const clave =
      definicion.entity === 'CONTACT'
        ? {
            definitionId_contactId: {
              definitionId: definicion.id,
              contactId: contactId!,
            },
          }
        : {
            definitionId_leadId: {
              definitionId: definicion.id,
              leadId: leadId!,
            },
          };

    return this.prisma.$transaction(async (tx) => {
      const anterior = await tx.customFieldValue.findUnique({ where: clave });
      const antes = comoCadena(definicion.type, anterior);
      const despues = comoCadena(definicion.type, valor);
      if (antes === despues) return false;

      await tx.customFieldValue.upsert({
        where: clave,
        create: {
          companyId,
          definitionId: definicion.id,
          contactId: contactId ?? null,
          leadId: leadId ?? null,
          ...valor,
        },
        update: { ...valor },
      });

      await tx.customFieldValueChange.create({
        data: {
          companyId,
          definitionId: definicion.id,
          entity: definicion.entity,
          entityId: (contactId ?? leadId)!,
          previousValue: antes,
          newValue: despues,
          source: origen.source,
          actorUserId: origen.actorUserId ?? null,
          executionId: origen.executionId ?? null,
        },
      });
      return true;
    });
  }

  /**
   * Comprueba que el contacto o la oportunidad son de ESTA empresa.
   *
   * Sin esto, un id de otra empresa se escribiría igual: la clave ajena apunta
   * a la tabla, no a la empresa, así que la base no lo impediría.
   */
  private async destinoDeLaEmpresa(
    companyId: string,
    entity: CustomFieldEntity,
    destino: DestinoValor,
  ): Promise<{ contactId?: string; leadId?: string }> {
    if (entity === 'CONTACT') {
      if (!destino.contactId) {
        throw new BadRequestException('Falta el contacto');
      }
      const c = await this.prisma.contact.findFirst({
        where: { id: destino.contactId, companyId },
        select: { id: true },
      });
      if (!c) throw new NotFoundException('Contacto no encontrado');
      return { contactId: c.id };
    }

    if (!destino.leadId) throw new BadRequestException('Falta la oportunidad');
    const l = await this.prisma.lead.findFirst({
      where: { id: destino.leadId, companyId },
      select: { id: true },
    });
    if (!l) throw new NotFoundException('Oportunidad no encontrada');
    return { leadId: l.id };
  }

  /**
   * Lee los valores de una entidad, ya formateados.
   *
   * Devuelve TODAS las definiciones activas, con `valor: null` para las que no
   * tienen dato. Un panel que solo recibiera los campos rellenos no podría
   * mostrar los vacíos, y el asesor no sabría que existen.
   */
  async leerValores(
    companyId: string,
    entity: CustomFieldEntity,
    entityId: string,
  ): Promise<ValorLegible[]> {
    const definiciones = await this.prisma.customFieldDefinition.findMany({
      where: { companyId, entity, isActive: true },
      orderBy: [{ order: 'asc' }, { label: 'asc' }],
      include: {
        values: {
          where:
            entity === 'CONTACT'
              ? { contactId: entityId, companyId }
              : { leadId: entityId, companyId },
          take: 1,
        },
      },
    });

    return definiciones.map((d) => {
      const v = d.values[0] ?? null;
      return {
        key: d.key,
        label: d.label,
        type: d.type,
        valor: comoCadena(d.type, v),
        crudo: v ? this.crudoDe(d.type, v) : null,
      };
    });
  }

  /** El valor en su tipo natural, para las APIs que lo consuman. */
  private crudoDe(
    tipo: CustomFieldType,
    v: {
      valueText: string | null;
      valueNumber: Prisma.Decimal | null;
      valueBool: boolean | null;
      valueDate: Date | null;
      valueList: string[];
    },
  ): unknown {
    switch (tipo) {
      case 'NUMBER':
      case 'CURRENCY':
        return v.valueNumber ? v.valueNumber.toNumber() : null;
      case 'BOOLEAN':
        return v.valueBool;
      case 'DATE':
      case 'DATETIME':
        return v.valueDate;
      case 'MULTI_SELECT':
        return v.valueList;
      default:
        return v.valueText;
    }
  }

  // ── retención del historial ─────────────────────────────────

  /**
   * Cuánto se conserva el historial de cambios, en días.
   *
   * EXISTE PORQUE EL HISTORIAL CRECE SIN LÍMITE. Un bot que escribe un campo
   * en cada mensaje deja una fila por cambio; con cien conversaciones al día
   * y tres campos, son cien mil filas al año por empresa. Sin retención, la
   * tabla acaba pesando más que los datos que explica.
   *
   * NOVENTA DÍAS por defecto: cubre el trimestre de una reclamación, que es
   * el plazo en que alguien pregunta «¿por qué cambió esto?».
   *
   * Se lee del entorno para que un despliegue con obligaciones distintas
   * —retención legal más larga— pueda subirlo sin tocar código. `0` lo
   * desactiva: quien necesite conservarlo todo puede hacerlo explícitamente.
   */
  private diasDeRetencion(): number {
    const bruto = Number(process.env.CUSTOM_FIELD_HISTORY_DAYS ?? 90);
    if (!Number.isFinite(bruto) || bruto < 0) return 90;
    return Math.floor(bruto);
  }

  /**
   * Compacta el historial viejo.
   *
   * NO BORRA A CIEGAS. De cada (entidad, campo) conserva SIEMPRE el cambio más
   * reciente aunque esté fuera del plazo: sin él, un campo que se escribió una
   * vez hace un año perdería toda explicación de por qué tiene ese valor, que
   * es justo la pregunta que el historial existe para responder.
   *
   * ACOTADO por lote. Un primer barrido sobre una tabla que lleva años sin
   * limpiarse borraría millones de filas en una transacción y bloquearía la
   * tabla; a lotes tarda más y no interrumpe a nadie.
   */
  async compactarHistorial(
    companyId: string,
    opciones: { lote?: number; ahora?: Date } = {},
  ): Promise<{ borrados: number; conservadosPorSerLosUltimos: number }> {
    const dias = this.diasDeRetencion();
    if (dias === 0) {
      return { borrados: 0, conservadosPorSerLosUltimos: 0 };
    }

    const lote = Math.min(opciones.lote ?? 1000, 5000);
    const corte = new Date(
      (opciones.ahora ?? new Date()).getTime() - dias * 24 * 60 * 60_000,
    );

    const viejos = await this.prisma.customFieldValueChange.findMany({
      where: { companyId, createdAt: { lt: corte } },
      orderBy: { createdAt: 'asc' },
      take: lote,
      select: {
        id: true,
        definitionId: true,
        entityId: true,
        createdAt: true,
      },
    });
    if (viejos.length === 0) {
      return { borrados: 0, conservadosPorSerLosUltimos: 0 };
    }

    // El último de cada (entidad, campo) se salva, mire lo que mire el plazo.
    const ultimos = new Map<string, { id: string; createdAt: Date }>();
    for (const v of viejos) {
      const clave = `${v.definitionId}:${v.entityId}`;
      const actual = ultimos.get(clave);
      if (!actual || v.createdAt > actual.createdAt) {
        ultimos.set(clave, { id: v.id, createdAt: v.createdAt });
      }
    }

    // …salvo que exista uno MÁS reciente fuera del lote, en cuyo caso el de
    // aquí ya no es el último y sí se puede borrar.
    const intocables = new Set<string>();
    for (const [clave, candidato] of ultimos) {
      const [definitionId, entityId] = clave.split(':');
      const hayMasReciente = await this.prisma.customFieldValueChange.findFirst(
        {
          where: {
            companyId,
            definitionId,
            entityId,
            createdAt: { gt: candidato.createdAt },
          },
          select: { id: true },
        },
      );
      if (!hayMasReciente) intocables.add(candidato.id);
    }

    const aBorrar = viejos.map((v) => v.id).filter((id) => !intocables.has(id));

    if (aBorrar.length === 0) {
      return {
        borrados: 0,
        conservadosPorSerLosUltimos: intocables.size,
      };
    }

    const { count } = await this.prisma.customFieldValueChange.deleteMany({
      where: { companyId, id: { in: aBorrar } },
    });

    this.logger.log(
      `Historial de campos compactado: ${count} borrados, ${intocables.size} conservados por ser los últimos [empresa=${companyId}]`,
    );
    return { borrados: count, conservadosPorSerLosUltimos: intocables.size };
  }

  /** Historial de un campo o de una entidad. Para el panel y para soporte. */
  async historial(
    companyId: string,
    filtro: { entity?: CustomFieldEntity; entityId?: string; limite?: number },
  ) {
    return this.prisma.customFieldValueChange.findMany({
      where: {
        companyId,
        ...(filtro.entity ? { entity: filtro.entity } : {}),
        ...(filtro.entityId ? { entityId: filtro.entityId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(filtro.limite ?? 50, 200),
      include: {
        definition: { select: { key: true, label: true, type: true } },
        actor: { select: { id: true, name: true } },
      },
    });
  }
}
