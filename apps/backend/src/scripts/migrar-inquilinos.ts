/**
 * Fase 5 — Herramienta de migración de las empresas existentes.
 *
 * Se ejecuta a mano contra un entorno ya configurado. NUNCA imprime nombres de
 * empresa, correos ni configuración: solo identificadores abreviados, conteos y
 * decisiones.
 *
 *   node dist/src/scripts/migrar-inquilinos ensayo
 *   node dist/src/scripts/migrar-inquilinos aplicar --confirmar
 *   node dist/src/scripts/migrar-inquilinos verificar
 *   node dist/src/scripts/migrar-inquilinos revertir --manifiesto <ruta>
 *
 * El modo por defecto es el ensayo en seco: sin orden, no escribe nada.
 *
 * Guardas para escribir (`aplicar` y `revertir`):
 *   1. `--confirmar` explícito en la línea de órdenes.
 *   2. La variable `MIGRACION_FASE5_OBJETIVO` debe coincidir con el nombre de
 *      la base de datos de destino. Obliga a nombrar el destino a conciencia y
 *      evita ejecutar contra la base equivocada por un copiar y pegar.
 *
 * El manifiesto se escribe donde diga `--salida`. Contiene configuración real,
 * así que su sitio es fuera del repositorio y con permisos restrictivos.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { AppModule } from '../app.module';
import {
  MigracionDeInquilinosService,
  type Manifiesto,
} from '../modules/companies/migracion/migracion-de-inquilinos.service';

const ORDENES = ['ensayo', 'aplicar', 'verificar', 'revertir'] as const;
type Orden = (typeof ORDENES)[number];

function argumento(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function tieneBandera(nombre: string): boolean {
  return process.argv.includes(`--${nombre}`);
}

/**
 * Alcance opcional: `--empresa <id>` una o varias veces. Sin él se actúa sobre
 * todas las empresas, que es el caso normal; acotarlo permite migrar de forma
 * gradual empezando por una sola.
 */
function alcanceDeLaOrden(): string[] | undefined {
  const ids = process.argv
    .map((valor, i) => (valor === '--empresa' ? process.argv[i + 1] : null))
    .filter((valor): valor is string => Boolean(valor));
  return ids.length > 0 ? ids : undefined;
}

/** Nombre de la base de destino, sin credenciales ni host. */
function baseDeDatosDeDestino(): string {
  const url = process.env.DATABASE_URL ?? '';
  try {
    return new URL(url).pathname.replace(/^\//, '') || '(desconocida)';
  } catch {
    return '(desconocida)';
  }
}

/** Deja escribir solo con confirmación explícita y destino nombrado. */
function compruebaGuardas(log: Logger): boolean {
  if (!tieneBandera('confirmar')) {
    log.error('Falta --confirmar: esta orden escribe en la base de datos');
    return false;
  }
  const objetivo = process.env.MIGRACION_FASE5_OBJETIVO;
  const real = baseDeDatosDeDestino();
  if (!objetivo) {
    log.error(
      `Falta MIGRACION_FASE5_OBJETIVO. La base de destino es "${real}": ponla en la variable para confirmar que es la correcta`,
    );
    return false;
  }
  if (objetivo !== real) {
    log.error(
      `El destino no coincide: la variable dice "${objetivo}" y la base configurada es "${real}"`,
    );
    return false;
  }
  return true;
}

function guardaManifiesto(manifiesto: Manifiesto, ruta: string, log: Logger) {
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, JSON.stringify(manifiesto, null, 1), { mode: 0o600 });
  log.log(`Manifiesto escrito en ${ruta} (permisos 600)`);
}

/** Resumen sin datos privados: identificadores abreviados y conteos. */
function resumen(plan: {
  totales: Record<string, number>;
  catalogo: { porEmpresa: Array<{ empresa: string; filas: number }> };
  empresas: Array<{
    id: string;
    decision: string;
    motivos: string[];
    storedVersionAntes: number;
    storedVersionDespues: number;
    legacyAntes: string[];
    legacyDespues: string[];
  }>;
}) {
  return {
    totales: plan.totales,
    catalogoPorEmpresa: plan.catalogo.porEmpresa.map((e) => ({
      empresa: e.empresa.slice(0, 8),
      filas: e.filas,
    })),
    empresas: plan.empresas.map((e) => ({
      empresa: e.id.slice(0, 8),
      decision: e.decision,
      version: `${e.storedVersionAntes} -> ${e.storedVersionDespues}`,
      porCompatibilidad: `${e.legacyAntes.join('+') || 'ninguno'} -> ${e.legacyDespues.join('+') || 'ninguno'}`,
      motivos: e.motivos,
    })),
  };
}

async function main() {
  const log = new Logger('MigracionFase5');
  const orden = (process.argv[2] ?? 'ensayo') as Orden;

  if (!ORDENES.includes(orden)) {
    log.error(`Uso: ${ORDENES.join(' | ')}`);
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: false,
  });
  const migracion = app.get(MigracionDeInquilinosService);

  try {
    if (orden === 'ensayo') {
      const alcance = alcanceDeLaOrden();
      const { plan, manifiesto } = await migracion.ensayoEnSeco(alcance);
      log.log(
        `Destino: ${baseDeDatosDeDestino()} (ensayo en seco, no escribe)` +
          (alcance ? ` — acotado a ${alcance.length} empresas` : ''),
      );
      log.log(JSON.stringify(resumen(plan), null, 1));
      const salida = argumento('salida');
      if (salida) guardaManifiesto(manifiesto, salida, log);
      if (plan.totales.ambiguas > 0) {
        log.warn(
          `${plan.totales.ambiguas} empresas quedan sin tocar por ambigüedad: hay que decidirlas a mano`,
        );
        process.exitCode = 1;
      }
      return;
    }

    if (orden === 'aplicar') {
      if (!compruebaGuardas(log)) {
        process.exitCode = 1;
        return;
      }
      const resultado = await migracion.aplicar(alcanceDeLaOrden());
      log.log(
        JSON.stringify(
          {
            destino: baseDeDatosDeDestino(),
            filasDeCatalogo: resultado.filasDeCatalogoActualizadas,
            empresas: resultado.empresasCanonicalizadas,
            ambiguas: resultado.manifiesto.ambiguas.map((a) => ({
              empresa: a.id.slice(0, 8),
              motivos: a.motivos,
            })),
            conteos: resultado.manifiesto.conteos,
          },
          null,
          1,
        ),
      );
      const salida = argumento('salida');
      if (salida) {
        guardaManifiesto(resultado.manifiesto, salida, log);
      } else {
        log.warn(
          'Sin --salida no queda manifiesto: la reversión campo por campo dependería del respaldo',
        );
      }
      return;
    }

    if (orden === 'verificar') {
      const verificacion = await migracion.verificar(alcanceDeLaOrden());
      log.log(JSON.stringify(verificacion, null, 1));
      if (!verificacion.ok) process.exitCode = 1;
      return;
    }

    if (orden === 'revertir') {
      const ruta = argumento('manifiesto');
      if (!ruta) {
        log.error('Falta --manifiesto <ruta>');
        process.exitCode = 1;
        return;
      }
      if (!compruebaGuardas(log)) {
        process.exitCode = 1;
        return;
      }
      const manifiesto = JSON.parse(readFileSync(ruta, 'utf8')) as Manifiesto;
      const resultado = await migracion.revertir(manifiesto);
      log.log(JSON.stringify(resultado, null, 1));
    }
  } catch (error) {
    log.error(error instanceof Error ? error.message : 'error desconocido');
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
