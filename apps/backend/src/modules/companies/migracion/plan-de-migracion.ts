/**
 * Fase 5 — Decisión de migración de UNA empresa, sin base de datos.
 *
 * Todo lo que decide si una empresa se canonicaliza vive aquí y es una función
 * pura: recibe lo que hay guardado y devuelve la decisión, el objeto canónico
 * propuesto y, si algo no cuadra, los motivos exactos por los que NO se toca.
 *
 * La regla que gobierna el módulo entero: la migración materializa lo que el
 * producto ya devuelve al leer. No inventa configuración. Si al reconstruir se
 * perdiera cualquier dato o cambiara cualquier salida observable, la empresa se
 * marca AMBIGUA y queda intacta para decidirla a mano.
 */
import {
  buildCompanySettingsV2,
  parseCompanySettings,
  type CompanySettingsV2,
  type NormalizedCompanySettings,
} from '../company-settings';
import {
  buildTenantConfiguration,
  type CompanyConfigurationRow,
  type TenantConfigurationV1,
  type TenantPipeline,
} from '../tenant-configuration';
import { resolveEffectiveCommercial } from '../tenant-capabilities';

/** Versión de la herramienta; viaja en el manifiesto y en la auditoría. */
export const MIGRACION_FASE_5_VERSION = 1;

export type DecisionDeEmpresa = 'SIN_CAMBIOS' | 'CANONICALIZAR' | 'AMBIGUA';

/** Datos que hay que traer de la base para decidir una empresa. */
export interface EntradaDeEmpresa {
  id: string;
  /** El JSON tal y como está guardado, sin normalizar. */
  settingsCrudos: unknown;
  /** Columnas regionales y de identidad, que la migración NO toca. */
  company: CompanyConfigurationRow;
  /** Pipeline efectivo con la misma regla que el motor de configuración. */
  pipeline: TenantPipeline | null;
  /** Datos existentes por módulo: red de seguridad contra apagar algo con uso. */
  volumen: { productos: number; cotizaciones: number; tareas: number };
}

export interface PlanDeEmpresa {
  id: string;
  decision: DecisionDeEmpresa;
  /** Motivos por los que la empresa queda AMBIGUA. Vacío en el resto de casos. */
  motivos: string[];
  storedVersionAntes: 0 | 1 | 2;
  storedVersionDespues: 0 | 1 | 2;
  /** Módulos activos por compatibilidad antes y después (la diferencia esperada). */
  legacyAntes: string[];
  legacyDespues: string[];
  /** Objeto a escribir. `null` si no hay nada que escribir. */
  canonico: CompanySettingsV2 | null;
}

// ── Utilidades ───────────────────────────────────────────────────────────

/** Igualdad estructural. Compara objetos por clave, no por orden de escritura. */
export function igualdadProfunda(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((valor, i) => igualdadProfunda(valor, b[i]));
  }
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  const ca = a as Record<string, unknown>;
  const cb = b as Record<string, unknown>;
  const clavesA = Object.keys(ca).sort();
  const clavesB = Object.keys(cb).sort();
  if (clavesA.length !== clavesB.length) return false;
  if (!clavesA.every((k, i) => k === clavesB[i])) return false;
  return clavesA.every((k) => igualdadProfunda(ca[k], cb[k]));
}

function esObjetoPlano(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/**
 * Configuración efectiva sin los dos campos que la canonicalización SÍ puede
 * cambiar. Todo lo demás debe ser idéntico antes y después.
 */
function observableEstable(config: TenantConfigurationV1) {
  return {
    contractVersion: config.contractVersion,
    identity: config.identity,
    regional: config.regional,
    modules: config.modules,
    catalogo: config.capabilities.catalog,
    categorias: config.catalog.categories,
    allowFreeText: config.catalog.allowFreeText,
    pipeline: config.pipeline,
    limits: config.limits,
  };
}

function configuracionDe(
  entrada: EntradaDeEmpresa,
  settings: NormalizedCompanySettings,
): TenantConfigurationV1 {
  return buildTenantConfiguration({
    company: entrada.company,
    settings,
    pipeline: entrada.pipeline,
  });
}

// ── Detección de pérdida de datos ────────────────────────────────────────

/**
 * Comprueba que NADA de lo guardado se pierde al reconstruir. Devuelve los
 * motivos encontrados; vacío significa que la reconstrucción es fiel.
 */
function motivosDePerdida(
  crudos: unknown,
  parsed: NormalizedCompanySettings,
  canonico: CompanySettingsV2,
): string[] {
  const motivos: string[] = [];

  // 1. Las claves ajenas al contrato tienen que sobrevivir con su valor exacto.
  //    `buildCompanySettingsV2` las vuelca primero, así que una clave llamada
  //    como el contrato (por ejemplo `version` en un documento antiguo) sería
  //    pisada: eso es una pérdida real y hay que detenerse.
  for (const [clave, valor] of Object.entries(parsed.extra)) {
    if (
      !igualdadProfunda((canonico as Record<string, unknown>)[clave], valor)
    ) {
      motivos.push(`la clave desconocida ${clave} no sobrevive al canónico`);
    }
  }

  if (!esObjetoPlano(crudos)) {
    // Sin settings guardados no hay nada que perder.
    return motivos;
  }

  // 2. Sub-claves de catálogo distintas de las categorías: el canónico solo
  //    conserva `categories` y `allowFreeText`.
  const catalogo = crudos.catalog;
  if (esObjetoPlano(catalogo)) {
    const sobrantes = Object.keys(catalogo).filter(
      (k) => k !== 'categories' && k !== 'allowFreeText',
    );
    if (sobrantes.length > 0) {
      motivos.push(
        `el catálogo guardado trae claves que el canónico no conserva: ${sobrantes.sort().join(', ')}`,
      );
    }
  }

  // 3. Vertical o ajustes de pipeline con forma inválida: hoy se leen como
  //    nulos, pero el valor sigue en la base. Reescribir lo borraría.
  if (crudos.vertical !== undefined && parsed.vertical === null) {
    motivos.push('el vertical guardado tiene una forma que el parser descarta');
  }
  if (
    crudos.pipelineDefaults !== undefined &&
    parsed.pipelineDefaults === null
  ) {
    motivos.push(
      'los ajustes de pipeline guardados tienen una forma que el parser descarta',
    );
  }

  // 4. Categorías: si la normalización recorta, deduplica o descarta alguna,
  //    el texto guardado no es el que quedaría escrito.
  const categoriasCrudas = esObjetoPlano(catalogo)
    ? catalogo.categories
    : crudos.categories;
  if (
    categoriasCrudas !== undefined &&
    !igualdadProfunda(categoriasCrudas, parsed.catalog.categories)
  ) {
    motivos.push(
      'la lista de categorías cambia al normalizarla: revisar a mano antes de escribir',
    );
  }

  return motivos;
}

/**
 * Red de seguridad: ningún módulo que hoy esté ENCENDIDO puede quedar apagado
 * teniendo datos. Se compara antes con después, nunca el valor absoluto: una
 * empresa puede haber apagado su catálogo a conciencia conservando elementos
 * antiguos, y eso es legítimo y no se toca.
 *
 * Por diseño los módulos efectivos no cambian, así que esto no debería
 * dispararse nunca; si se dispara, hay un error en el razonamiento anterior y
 * no se escribe nada.
 */
function motivosDeApagadoConDatos(
  antes: TenantConfigurationV1,
  despues: TenantConfigurationV1,
  volumen: EntradaDeEmpresa['volumen'],
): string[] {
  const motivos: string[] = [];
  const seApaga = (clave: 'catalog' | 'quotes' | 'tasks') =>
    antes.modules[clave] && !despues.modules[clave];

  if (seApaga('catalog') && volumen.productos > 0) {
    motivos.push('el catálogo quedaría apagado teniendo elementos guardados');
  }
  if (seApaga('quotes') && volumen.cotizaciones > 0) {
    motivos.push('las cotizaciones quedarían apagadas teniendo cotizaciones');
  }
  if (seApaga('tasks') && volumen.tareas > 0) {
    motivos.push('las tareas quedarían apagadas teniendo tareas');
  }
  return motivos;
}

// ── Decisión ─────────────────────────────────────────────────────────────

/**
 * Decide qué hacer con una empresa. No escribe nada y no lanza: cualquier
 * problema se devuelve como AMBIGUA con su motivo.
 */
export function planificarEmpresa(entrada: EntradaDeEmpresa): PlanDeEmpresa {
  const parsed = parseCompanySettings(entrada.settingsCrudos);
  const configAntes = configuracionDe(entrada, parsed);

  const base: Omit<PlanDeEmpresa, 'decision' | 'motivos' | 'canonico'> = {
    id: entrada.id,
    storedVersionAntes: parsed.storedVersion,
    storedVersionDespues: parsed.storedVersion,
    legacyAntes: [...configAntes.capabilities.legacyDefaultsApplied],
    legacyDespues: [...configAntes.capabilities.legacyDefaultsApplied],
  };

  // El canónico se construye con la MISMA composición que usa el motor de
  // configuración al editar: banderas EFECTIVAS (no las normalizadas, que
  // apagarían los módulos activos por compatibilidad) y todo lo demás intacto.
  let canonico: CompanySettingsV2;
  try {
    canonico = buildCompanySettingsV2({
      commercial: resolveEffectiveCommercial(parsed),
      categories: parsed.catalog.categories,
      vertical: parsed.vertical,
      pipelineDefaults: parsed.pipelineDefaults,
      extra: parsed.extra,
    });
  } catch (error) {
    const detalle =
      error instanceof Error ? error.message : 'error desconocido';
    return {
      ...base,
      decision: 'AMBIGUA',
      motivos: [`el canónico no se puede construir: ${detalle}`],
      canonico: null,
    };
  }

  const motivos = motivosDePerdida(entrada.settingsCrudos, parsed, canonico);

  // Equivalencia: se compara la configuración efectiva que sirve la API antes y
  // después. Las dos únicas diferencias admitidas son la versión de
  // almacenamiento y la lista de módulos activos por compatibilidad.
  const parsedDespues = parseCompanySettings(canonico);
  const configDespues = configuracionDe(entrada, parsedDespues);
  if (
    !igualdadProfunda(
      observableEstable(configAntes),
      observableEstable(configDespues),
    )
  ) {
    motivos.push(
      'la configuración efectiva cambiaría: la reescritura no es equivalente',
    );
  }
  if (configDespues.capabilities.legacyDefaultsApplied.length > 0) {
    motivos.push(
      'el canónico seguiría dependiendo de valores de compatibilidad',
    );
  }
  motivos.push(
    ...motivosDeApagadoConDatos(configAntes, configDespues, entrada.volumen),
  );

  const resultado: PlanDeEmpresa = {
    ...base,
    storedVersionDespues: parsedDespues.storedVersion,
    legacyDespues: [...configDespues.capabilities.legacyDefaultsApplied],
    decision: 'CANONICALIZAR',
    motivos: [],
    canonico,
  };

  if (motivos.length > 0) {
    return {
      ...resultado,
      storedVersionDespues: parsed.storedVersion,
      legacyDespues: base.legacyDespues,
      decision: 'AMBIGUA',
      motivos,
      canonico: null,
    };
  }

  // Idempotencia: la comparación es estructural, no textual, así que una
  // empresa ya canónica no se reescribe aunque el orden de claves difiera.
  if (igualdadProfunda(entrada.settingsCrudos, canonico)) {
    return {
      ...resultado,
      decision: 'SIN_CAMBIOS',
      canonico: null,
    };
  }

  return resultado;
}
