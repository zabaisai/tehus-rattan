"use client";

import { useEffect, useState } from "react";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import {
  arrancarImportacion,
  cancelarImportacion,
  estadoDeImportacion,
  subirImportacion,
  urlDelReporte,
  validateProductImportFile,
  vistaPreviaDeImportacion,
} from "@/lib/products";
import type { Importacion, VistaPreviaDeImportacion } from "@/types";
import { Modal } from "@/components/ui/Modal";

type ApiError = {
  response?: { data?: { message?: string | string[] } };
};

function mensaje(e: unknown, respaldo: string): string {
  const m = (e as ApiError)?.response?.data?.message;
  if (Array.isArray(m)) return m[0] ?? respaldo;
  return m ?? respaldo;
}

type Paso = "elegir" | "revisar" | "procesando" | "terminado";

const ETIQUETA_ESTADO: Record<string, string> = {
  PENDING: "Lista para empezar",
  RUNNING: "Importando…",
  CANCELLING: "Cancelando…",
  CANCELLED: "Cancelada",
  COMPLETED: "Terminada",
  FAILED: "Falló",
};

const TERMINADAS = ["COMPLETED", "FAILED", "CANCELLED"];

/**
 * Importar un catálogo, en CUATRO pasos: subir, revisar el mapeo, procesar y
 * ver el resultado.
 *
 * Un botón único que subía y procesaba a la vez obligaba a esperar minutos con
 * la pantalla bloqueada, y si algo iba mal no había dónde mirar. Ahora el
 * progreso se consulta al servidor: quien lanza la importación puede cerrar la
 * ventana y volver, porque el estado es durable.
 */
export function ProductImportModal({
  onClose,
  onFinished,
}: {
  onClose: () => void;
  onFinished: () => void;
}) {
  const [paso, setPaso] = useState<Paso>("elegir");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [importacion, setImportacion] = useState<Importacion | null>(null);
  const [previa, setPrevia] = useState<VistaPreviaDeImportacion | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  /**
   * Sondeo del progreso mientras corre.
   *
   * Para en cuanto termina: seguir preguntando por algo acabado es tráfico que
   * no informa de nada.
   */
  useEffect(() => {
    if (paso !== "procesando" || !importacion) return;
    let vivo = true;

    const t = setInterval(async () => {
      try {
        const actual = await estadoDeImportacion(importacion.id);
        if (!vivo) return;
        setImportacion(actual);
        if (TERMINADAS.includes(actual.status)) {
          setPaso("terminado");
          onFinished();
        }
      } catch {
        // Un fallo puntual de red no cancela nada: la importación sigue en el
        // servidor y el siguiente sondeo la encuentra.
      }
    }, 1500);

    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [paso, importacion, onFinished]);

  function elegir(seleccionado: File | null) {
    setError("");
    if (seleccionado) {
      const problema = validateProductImportFile(seleccionado);
      if (problema) {
        setArchivo(null);
        setError(problema);
        return;
      }
    }
    setArchivo(seleccionado);
  }

  async function subir() {
    if (!archivo) return;
    setOcupado(true);
    setError("");
    try {
      const imp = await subirImportacion(archivo);
      setImportacion(imp);
      setPrevia(await vistaPreviaDeImportacion(imp.id));
      setPaso("revisar");
    } catch (e) {
      setError(mensaje(e, "No se pudo subir el archivo."));
    } finally {
      setOcupado(false);
    }
  }

  async function arrancar() {
    if (!importacion) return;
    setOcupado(true);
    setError("");
    try {
      await arrancarImportacion(importacion.id);
      setPaso("procesando");
    } catch (e) {
      setError(mensaje(e, "No se pudo arrancar la importación."));
    } finally {
      setOcupado(false);
    }
  }

  async function cancelar() {
    if (!importacion) return;
    try {
      await cancelarImportacion(importacion.id);
    } catch (e) {
      setError(mensaje(e, "No se pudo cancelar."));
    }
  }

  const porcentaje = importacion?.porcentaje ?? 0;

  return (
    <Modal title="Importar catálogo" onClose={onClose} maxWidth="lg">
      {error && (
        <p
          role="alert"
          className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      {paso === "elegir" && (
        <div className="space-y-3">
          <p className="text-sm text-neutral-600">
            Acepta <strong>.xlsx</strong> y <strong>.csv</strong>. Los archivos
            con macros (.xlsm) no se aceptan.
          </p>
          <label className="block">
            <span className="text-sm text-neutral-700">Archivo</span>
            <input
              type="file"
              accept=".xlsx,.csv"
              aria-label="Archivo del catálogo"
              onChange={(e) => elegir(e.target.files?.[0] ?? null)}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              Cancelar
            </button>
            <button
              disabled={!archivo || ocupado}
              onClick={() => void subir()}
              className="flex items-center gap-2 rounded-md bg-brand-primary px-4 py-2 text-sm text-white hover:bg-primary-900 disabled:opacity-40"
            >
              {ocupado ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <FileSpreadsheet size={15} />
              )}
              Subir y revisar
            </button>
          </div>
        </div>
      )}

      {paso === "revisar" && previa && (
        <div className="space-y-3">
          <p className="text-sm text-neutral-600">
            Así se leyó el archivo. Comprueba que cada columna va donde debe
            antes de empezar.
          </p>

          <div className="overflow-x-auto rounded-lg border border-neutral-200">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 text-left">
                  {previa.cabeceras.map((c, i) => {
                    const campo = Object.entries(
                      previa.mapeoPropuesto.campos,
                    ).find(([, indice]) => indice === i)?.[0];
                    return (
                      <th key={i} className="px-2 py-2 font-medium">
                        <span className="block text-neutral-800">{c}</span>
                        <span
                          className={
                            campo
                              ? "text-[10px] text-status-success"
                              : "text-[10px] text-neutral-400"
                          }
                        >
                          {campo ?? "sin asignar"}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {previa.filas.map((fila, i) => (
                  <tr
                    key={i}
                    className="border-b border-neutral-100 last:border-0"
                  >
                    {fila.map((v, j) => (
                      <td
                        key={j}
                        className="max-w-40 truncate px-2 py-1.5 text-neutral-700"
                      >
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {previa.mapeoPropuesto.sinAsignar.length > 0 && (
            <p className="text-xs text-neutral-500">
              Estas columnas no se reconocieron y se ignorarán:{" "}
              {previa.mapeoPropuesto.sinAsignar
                .map((c) => c.cabecera)
                .join(", ")}
              .
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              onClick={() => void cancelar().then(onClose)}
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              Descartar
            </button>
            <button
              disabled={ocupado}
              onClick={() => void arrancar()}
              className="flex items-center gap-2 rounded-md bg-brand-primary px-4 py-2 text-sm text-white hover:bg-primary-900 disabled:opacity-40"
            >
              {ocupado && <Loader2 size={15} className="animate-spin" />}
              Empezar la importación
            </button>
          </div>
        </div>
      )}

      {paso === "procesando" && importacion && (
        <div className="space-y-3">
          <p className="text-sm text-neutral-700">
            {ETIQUETA_ESTADO[importacion.status] ?? importacion.status}
          </p>

          <div
            role="progressbar"
            aria-valuenow={porcentaje}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progreso de la importación"
            className="h-2 w-full overflow-hidden rounded-full bg-neutral-100"
          >
            <div
              className="h-full bg-brand-primary transition-[width]"
              style={{ width: `${porcentaje}%` }}
            />
          </div>

          <p className="font-mono text-xs text-neutral-600">
            {importacion.processedRows.toLocaleString("es-CO")} filas ·{" "}
            {importacion.created.toLocaleString("es-CO")} creados ·{" "}
            {importacion.updated.toLocaleString("es-CO")} actualizados ·{" "}
            {importacion.failed.toLocaleString("es-CO")} fallidos
          </p>

          <p className="text-xs text-neutral-500">
            Puedes cerrar esta ventana: la importación sigue en el servidor y su
            progreso se conserva.
          </p>

          <div className="flex justify-end gap-2">
            <button
              onClick={() => void cancelar()}
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              Cancelar importación
            </button>
            <button
              onClick={onClose}
              className="rounded-md bg-brand-primary px-4 py-2 text-sm text-white hover:bg-primary-900"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {paso === "terminado" && importacion && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-neutral-900">
            {ETIQUETA_ESTADO[importacion.status] ?? importacion.status}
          </p>

          {importacion.errorMessage && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {importacion.errorMessage}
            </p>
          )}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            {(
              [
                ["Creados", importacion.created],
                ["Actualizados", importacion.updated],
                ["Omitidos", importacion.skipped],
                ["Fallidos", importacion.failed],
              ] as const
            ).map(([etiqueta, valor]) => (
              <div key={etiqueta}>
                <dt className="text-xs text-neutral-500">{etiqueta}</dt>
                <dd className="font-mono text-neutral-900">
                  {valor.toLocaleString("es-CO")}
                </dd>
              </div>
            ))}
          </dl>

          {importacion.failed > 0 && (
            <a
              href={urlDelReporte(importacion.id)}
              className="inline-flex items-center gap-1.5 text-sm text-brand-primary hover:underline"
            >
              <Download size={14} />
              Descargar el reporte de errores
            </a>
          )}

          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="rounded-md bg-brand-primary px-4 py-2 text-sm text-white hover:bg-primary-900"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
