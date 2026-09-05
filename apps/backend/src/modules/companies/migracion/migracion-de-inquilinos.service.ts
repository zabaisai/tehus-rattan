/**
 * Fase 5 — Migración y consolidación de las empresas que ya existen.
 *
 * Dos objetivos, una sola herramienta:
 *
 *   A. Rellenar `products.itemType` donde vale NULL con el valor que la
 *      aplicación ya devuelve al leer esas filas (PRODUCT).
 *   B. Escribir la configuración de cada empresa en su forma canónica actual,
 *      conservando exactamente el comportamiento efectivo.
 *
 * Nada se escribe fuera de esas dos columnas. La decisión de cada empresa vive
 * en `plan-de-migracion.ts` y es una función pura; aquí solo se lee la base, se
 * aplica el plan dentro de una transacción con guardas de conteo y se produce
 * el manifiesto que permite revertir campo por campo.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  MIGRACION_FASE_5_VERSION,
  planificarEmpresa,
  type PlanDeEmpresa,
} from './plan-de-migracion';
import type { TenantPipeline } from '../tenant-configuration';

/** Acción de auditoría propia de esta migración. */
export const MIGRACION_AUDIT_ACTION = 'company.migration.phase5';

/**
 * Cerrojo de asesoramiento: impide que dos ejecuciones se pisen. Es un número
 * fijo y arbitrario, exclusivo de esta herramienta.
 */
const CLAVE_DE_CERROJO = 520250905;

type ClienteDeTransaccion = Prisma.TransactionClient;

/**
 * Empresas sobre las que actúa una ejecución. Sin alcance se migran todas;
 * acotarlo permite migrar de forma gradual y aislar las pruebas de extremo a
 * extremo del resto de la base.
 */
export type Alcance = string[] | undefined;

/** Filtro por empresa para las consultas de catálogo. */
function filtroDeEmpresa(alcance: Alcance) {
  return alcance ? { companyId: { in: alcance } } : {};
}

export interface ResumenDeCatalogo {
  /** Identificadores de las filas sin tipo, en orden estable. */
  filasSinTipo: string[];
  porEmpresa: Array<{ empresa: string; filas: number }>;
  conteoAntes: { producto: number; servicio: number; nulo: number };
}

export interface PlanCompleto {
  version: number;
  catalogo: ResumenDeCatalogo;
  empresas: PlanDeEmpresa[];
  totales: {
    empresas: number;
    canonicalizar: number;
    sinCambios: number;
    ambiguas: number;
    filasDeCatalogo: number;
  };
}

export interface EntradaDeManifiestoDeEmpresa {
  id: string;
  /** Valor anterior EXACTO, incluido `null`. Sirve para revertir. */
  antes: Prisma.JsonValue | null;
  despues: Prisma.JsonValue;
  storedVersionAntes: 0 | 1 | 2;
  storedVersionDespues: 0 | 1 | 2;
}

export interface Manifiesto {
  version: number;
  generadoEn: string;
  modo: 'dry-run' | 'apply';
  catalogo: { filas: string[] };
  empresas: EntradaDeManifiestoDeEmpresa[];
  conteos: {
    antes: { producto: number; servicio: number; nulo: number };
    despues?: { producto: number; servicio: number; nulo: number };
  };
  ambiguas: Array<{ id: string; motivos: string[] }>;
}

export interface ResultadoDeAplicacion {
  manifiesto: Manifiesto;
  filasDeCatalogoActualizadas: number;
  empresasCanonicalizadas: number;
}

export interface Verificacion {
  ok: boolean;
  problemas: string[];
  catalogo: { producto: number; servicio: number; nulo: number };
  empresasPorVersion: Record<string, number>;
}

const SELECCION_DE_EMPRESA = {
  id: true,
  country: true,
  timezone: true,
  currency: true,
  locale: true,
  businessType: true,
  settings: true,
} as const;

@Injectable()
export class MigracionDeInquilinosService {
  private readonly logger = new Logger(MigracionDeInquilinosService.name);

  constructor(private prisma: PrismaService) {}

  // ── Lectura ────────────────────────────────────────────────────────────

  /**
   * Pipeline efectivo de una empresa. Repite EXACTAMENTE la regla del motor de
   * configuración para que la comparación antes/después sea la que ve la API.
   */
  private async pipelineEfectivo(
    tx: ClienteDeTransaccion | PrismaService,
    companyId: string,
  ): Promise<TenantPipeline | null> {
    const fila = await tx.pipeline.findFirst({
      where: { companyId, isArchived: false },
      orderBy: [
        { isDefault: 'desc' },
        { order: 'asc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      select: {
        id: true,
        name: true,
        stages: {
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            name: true,
            type: true,
            isInitial: true,
            order: true,
          },
        },
      },
    });
    return fila ? { id: fila.id, name: fila.name, stages: fila.stages } : null;
  }

  private async conteosDeCatalogo(
    tx: ClienteDeTransaccion | PrismaService,
    alcance: Alcance,
  ) {
    const empresa = filtroDeEmpresa(alcance);
    const [producto, servicio, nulo] = await Promise.all([
      tx.product.count({ where: { ...empresa, itemType: 'PRODUCT' } }),
      tx.product.count({ where: { ...empresa, itemType: 'SERVICE' } }),
      tx.product.count({ where: { ...empresa, itemType: null } }),
    ]);
    return { producto, servicio, nulo };
  }

  /**
   * Calcula el plan completo sin escribir nada. Se usa tal cual en el ensayo en
   * seco y se vuelve a calcular dentro de la transacción al aplicar, para no
   * actuar nunca sobre una foto vieja.
   */
  async planificar(
    tx: ClienteDeTransaccion | PrismaService = this.prisma,
    alcance: Alcance = undefined,
  ): Promise<PlanCompleto> {
    const sinTipo = await tx.product.findMany({
      where: { ...filtroDeEmpresa(alcance), itemType: null },
      orderBy: { id: 'asc' },
      select: { id: true, companyId: true },
    });

    const porEmpresa = new Map<string, number>();
    for (const fila of sinTipo) {
      porEmpresa.set(fila.companyId, (porEmpresa.get(fila.companyId) ?? 0) + 1);
    }

    const catalogo: ResumenDeCatalogo = {
      filasSinTipo: sinTipo.map((f) => f.id),
      porEmpresa: [...porEmpresa.entries()]
        .map(([empresa, filas]) => ({ empresa, filas }))
        .sort((a, b) => a.empresa.localeCompare(b.empresa)),
      conteoAntes: await this.conteosDeCatalogo(tx, alcance),
    };

    const empresas = await tx.company.findMany({
      where: alcance ? { id: { in: alcance } } : {},
      orderBy: { createdAt: 'asc' },
      select: SELECCION_DE_EMPRESA,
    });

    const planes: PlanDeEmpresa[] = [];
    for (const empresa of empresas) {
      const [productos, cotizaciones, tareas, pipeline] = await Promise.all([
        tx.product.count({ where: { companyId: empresa.id } }),
        tx.quote.count({ where: { companyId: empresa.id } }),
        tx.task.count({ where: { companyId: empresa.id } }),
        this.pipelineEfectivo(tx, empresa.id),
      ]);

      planes.push(
        planificarEmpresa({
          id: empresa.id,
          settingsCrudos: empresa.settings ?? null,
          company: {
            country: empresa.country,
            timezone: empresa.timezone,
            currency: empresa.currency,
            locale: empresa.locale,
            businessType: empresa.businessType,
          },
          pipeline,
          volumen: { productos, cotizaciones, tareas },
        }),
      );
    }

    return {
      version: MIGRACION_FASE_5_VERSION,
      catalogo,
      empresas: planes,
      totales: {
        empresas: planes.length,
        canonicalizar: planes.filter((p) => p.decision === 'CANONICALIZAR')
          .length,
        sinCambios: planes.filter((p) => p.decision === 'SIN_CAMBIOS').length,
        ambiguas: planes.filter((p) => p.decision === 'AMBIGUA').length,
        filasDeCatalogo: catalogo.filasSinTipo.length,
      },
    };
  }

  /** Manifiesto del ensayo en seco: lo que se escribiría, sin escribirlo. */
  async ensayoEnSeco(
    alcance: Alcance = undefined,
  ): Promise<{ plan: PlanCompleto; manifiesto: Manifiesto }> {
    const plan = await this.planificar(this.prisma, alcance);
    const empresas = await this.prisma.company.findMany({
      where: {
        id: {
          in: plan.empresas
            .filter((p) => p.decision === 'CANONICALIZAR')
            .map((p) => p.id),
        },
      },
      select: { id: true, settings: true },
    });
    const anteriores = new Map(empresas.map((e) => [e.id, e.settings]));

    return {
      plan,
      manifiesto: {
        version: MIGRACION_FASE_5_VERSION,
        generadoEn: new Date().toISOString(),
        modo: 'dry-run',
        catalogo: { filas: plan.catalogo.filasSinTipo },
        empresas: plan.empresas
          .filter((p) => p.decision === 'CANONICALIZAR')
          .map((p) => ({
            id: p.id,
            antes: anteriores.get(p.id) ?? null,
            despues: p.canonico as unknown as Prisma.JsonValue,
            storedVersionAntes: p.storedVersionAntes,
            storedVersionDespues: p.storedVersionDespues,
          })),
        conteos: { antes: plan.catalogo.conteoAntes },
        ambiguas: plan.empresas
          .filter((p) => p.decision === 'AMBIGUA')
          .map((p) => ({ id: p.id, motivos: p.motivos })),
      },
    };
  }

  // ── Escritura ──────────────────────────────────────────────────────────

  /**
   * Aplica el plan dentro de UNA transacción, con cerrojo y guardas de conteo.
   * Si cualquier guarda falla, no entra nada.
   */
  async aplicar(alcance: Alcance = undefined): Promise<ResultadoDeAplicacion> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CLAVE_DE_CERROJO}::bigint)`;

      // El plan se recalcula DENTRO de la transacción: nunca se actúa sobre una
      // foto tomada antes del cerrojo.
      const plan = await this.planificar(tx, alcance);
      const conteoAntes = plan.catalogo.conteoAntes;

      // ── A. Catálogo ────────────────────────────────────────────────────
      const filas = plan.catalogo.filasSinTipo;
      let filasActualizadas = 0;
      if (filas.length > 0) {
        // SQL directo a propósito, NO `updateMany`: Prisma actualizaría también
        // `updatedAt`, y esta migración no modifica la fila desde el punto de
        // vista del producto —escribe el tipo que la API ya devolvía—. Cambiar
        // la fecha de actualización de todo el catálogo antiguo sería afirmar
        // una edición que nunca ocurrió.
        //
        // La doble condición es deliberada: si otra transacción tipó una fila
        // entre el plan y esta escritura, aquí ya no se toca.
        filasActualizadas = await tx.$executeRaw`
          UPDATE "products"
             SET "itemType" = 'PRODUCT'::"CatalogItemType"
           WHERE "itemType" IS NULL
             AND "id" = ANY(${filas}::text[])
        `;
        if (filasActualizadas !== filas.length) {
          throw new Error(
            `guarda de conteo del catálogo: se planificaron ${filas.length} filas y se actualizaron ${filasActualizadas}`,
          );
        }
      }

      // ── B. Configuración ───────────────────────────────────────────────
      const aCanonicalizar = plan.empresas.filter(
        (p) => p.decision === 'CANONICALIZAR' && p.canonico !== null,
      );

      const anteriores = new Map<string, Prisma.JsonValue | null>();
      const entradas: EntradaDeManifiestoDeEmpresa[] = [];

      for (const empresa of aCanonicalizar) {
        const bloqueada = await tx.$queryRaw<
          { id: string; settings: Prisma.JsonValue | null }[]
        >`
          SELECT "id", "settings" FROM "companies" WHERE "id" = ${empresa.id} FOR UPDATE
        `;
        if (bloqueada.length === 0) {
          throw new Error(
            `la empresa ${empresa.id.slice(0, 8)} desapareció durante la migración`,
          );
        }
        anteriores.set(empresa.id, bloqueada[0].settings);

        await tx.company.update({
          where: { id: empresa.id },
          data: {
            settings: empresa.canonico as unknown as Prisma.InputJsonValue,
          },
        });

        entradas.push({
          id: empresa.id,
          antes: bloqueada[0].settings,
          despues: empresa.canonico as unknown as Prisma.JsonValue,
          storedVersionAntes: empresa.storedVersionAntes,
          storedVersionDespues: empresa.storedVersionDespues,
        });

        // Auditoría de sistema: sin actor humano, sin valores de configuración.
        await tx.auditLog.create({
          data: {
            actorUserId: null,
            actorRole: Role.SUPER_ADMIN,
            affectedCompanyId: empresa.id,
            action: MIGRACION_AUDIT_ACTION,
            entityType: 'Company',
            entityId: empresa.id,
            reason: 'Fase 5: consolidación de la configuración existente',
            metadata: {
              herramienta: MIGRACION_FASE_5_VERSION,
              storageVersion: {
                antes: empresa.storedVersionAntes,
                despues: empresa.storedVersionDespues,
              },
              modulosPorCompatibilidad: {
                antes: empresa.legacyAntes,
                despues: empresa.legacyDespues,
              },
            },
          },
        });
      }

      // ── Postcondiciones dentro de la misma transacción ─────────────────
      const conteoDespues = await this.conteosDeCatalogo(tx, alcance);
      if (conteoDespues.producto !== conteoAntes.producto + conteoAntes.nulo) {
        throw new Error(
          'guarda de conteo: los elementos de tipo producto no cuadran tras el relleno',
        );
      }
      if (conteoDespues.servicio !== conteoAntes.servicio) {
        throw new Error(
          'guarda de conteo: cambió el número de servicios, algo tocó filas que no debía',
        );
      }
      if (filas.length > 0 && conteoDespues.nulo !== 0) {
        throw new Error(
          'guarda de conteo: quedaron filas sin tipo tras aplicar el plan',
        );
      }

      // El plan recalculado tras escribir debe estar vacío: si no, la migración
      // no es idempotente y hay que revisarla antes de darla por buena.
      const planPosterior = await this.planificar(tx, alcance);
      if (
        planPosterior.totales.canonicalizar > 0 ||
        planPosterior.totales.filasDeCatalogo > 0
      ) {
        throw new Error(
          'guarda de idempotencia: tras aplicar, la herramienta seguiría teniendo trabajo pendiente',
        );
      }

      this.logger.log(
        `Fase 5 aplicada: ${filasActualizadas} filas de catálogo, ${entradas.length} empresas canonicalizadas, ${plan.totales.ambiguas} ambiguas`,
      );

      return {
        manifiesto: {
          version: MIGRACION_FASE_5_VERSION,
          generadoEn: new Date().toISOString(),
          modo: 'apply',
          catalogo: { filas },
          empresas: entradas,
          conteos: { antes: conteoAntes, despues: conteoDespues },
          ambiguas: plan.empresas
            .filter((p) => p.decision === 'AMBIGUA')
            .map((p) => ({ id: p.id, motivos: p.motivos })),
        },
        filasDeCatalogoActualizadas: filasActualizadas,
        empresasCanonicalizadas: entradas.length,
      };
    });
  }

  /** Comprueba las postcondiciones contra la base real, sin escribir. */
  async verificar(alcance: Alcance = undefined): Promise<Verificacion> {
    const problemas: string[] = [];
    const catalogo = await this.conteosDeCatalogo(this.prisma, alcance);
    if (catalogo.nulo > 0) {
      problemas.push(`quedan ${catalogo.nulo} elementos de catálogo sin tipo`);
    }

    const plan = await this.planificar(this.prisma, alcance);
    if (plan.totales.canonicalizar > 0) {
      problemas.push(
        `quedan ${plan.totales.canonicalizar} empresas por canonicalizar`,
      );
    }
    for (const ambigua of plan.empresas.filter(
      (p) => p.decision === 'AMBIGUA',
    )) {
      problemas.push(
        `empresa ${ambigua.id.slice(0, 8)} ambigua: ${ambigua.motivos.join('; ')}`,
      );
    }

    const empresasPorVersion: Record<string, number> = {};
    for (const empresa of plan.empresas) {
      const clave = `v${empresa.storedVersionAntes}`;
      empresasPorVersion[clave] = (empresasPorVersion[clave] ?? 0) + 1;
    }

    return {
      ok: problemas.length === 0,
      problemas,
      catalogo,
      empresasPorVersion,
    };
  }

  /**
   * Deshace exactamente lo que dice un manifiesto: las filas vuelven a NULL y
   * cada empresa recupera su configuración anterior, incluido el caso de que no
   * tuviera ninguna.
   */
  async revertir(manifiesto: Manifiesto): Promise<{
    filasRevertidas: number;
    empresasRevertidas: number;
  }> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CLAVE_DE_CERROJO}::bigint)`;

      let filasRevertidas = 0;
      if (manifiesto.catalogo.filas.length > 0) {
        // Igual que al aplicar: SQL directo para no tocar `updatedAt`.
        filasRevertidas = await tx.$executeRaw`
          UPDATE "products"
             SET "itemType" = NULL
           WHERE "itemType" = 'PRODUCT'::"CatalogItemType"
             AND "id" = ANY(${manifiesto.catalogo.filas}::text[])
        `;
        if (filasRevertidas !== manifiesto.catalogo.filas.length) {
          throw new Error(
            `guarda de reversión: el manifiesto lista ${manifiesto.catalogo.filas.length} filas y se revirtieron ${filasRevertidas}`,
          );
        }
      }

      for (const empresa of manifiesto.empresas) {
        await tx.company.update({
          where: { id: empresa.id },
          data: {
            settings:
              empresa.antes === null
                ? Prisma.DbNull
                : (empresa.antes as Prisma.InputJsonValue),
          },
        });
      }

      this.logger.log(
        `Fase 5 revertida: ${filasRevertidas} filas de catálogo y ${manifiesto.empresas.length} empresas`,
      );

      return {
        filasRevertidas,
        empresasRevertidas: manifiesto.empresas.length,
      };
    });
  }
}
