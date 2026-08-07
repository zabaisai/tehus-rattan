"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Loader2, X } from "lucide-react";
import {
  getResumenDeRetiro,
  getPipelines,
  trasladarOportunidades,
  archivarPipeline,
  deletePipeline,
} from "@/lib/pipeline";
import { Pipeline } from "@/types";

/**
 * Retirar un embudo.
 *
 * El punto entero de esta pantalla es que NUNCA se pierda una oportunidad sin
 * que alguien lo haya decidido. Primero se enseña cuántas hay y en qué etapa;
 * después se ofrecen las tres salidas reales —cancelar, archivar conservándolo
 * todo, o trasladar a otro embudo y entonces sí eliminar— y ninguna de ellas
 * borra oportunidades.
 */
export function RetirarEmbudoDialog({
  pipeline,
  onClose,
  onDone,
}: {
  pipeline: Pipeline;
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [destinoPipeline, setDestinoPipeline] = useState("");
  const [destinoEtapa, setDestinoEtapa] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resumen = useQuery({
    queryKey: ["pipeline-retiro", pipeline.id],
    queryFn: () => getResumenDeRetiro(pipeline.id),
    staleTime: 0,
  });

  const todos = useQuery({ queryKey: ["pipelines"], queryFn: getPipelines });

  // El propio embudo no puede ser su destino, y uno archivado tampoco:
  // mandar oportunidades a un archivado las esconde igual que perderlas.
  const candidatos = (todos.data ?? []).filter(
    (p) => p.id !== pipeline.id && !p.isArchived,
  );
  const etapasDestino =
    candidatos.find((p) => p.id === destinoPipeline)?.stages ?? [];

  async function ejecutar(
    accion: () => Promise<unknown>,
    mensaje: string,
  ): Promise<void> {
    setTrabajando(true);
    setError(null);
    try {
      await accion();
      onDone(mensaje);
    } catch (e: unknown) {
      setError(
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "No se pudo completar la operación.",
      );
      setTrabajando(false);
    }
  }

  const r = resumen.data;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-neutral-950/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-retirar-embudo"
    >
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-xl bg-white p-5 sm:max-w-lg sm:rounded-xl">
        <div className="flex items-start justify-between gap-3">
          <h3
            id="titulo-retirar-embudo"
            className="text-base font-semibold text-neutral-900"
          >
            Retirar «{pipeline.name}»
          </h3>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            <X size={18} />
          </button>
        </div>

        {resumen.isLoading && (
          <p className="flex items-center gap-2 py-8 text-sm text-neutral-500">
            <Loader2 size={15} className="animate-spin" />
            Comprobando qué hay dentro…
          </p>
        )}

        {resumen.isError && (
          <p className="mt-4 rounded-md bg-status-error-surface px-3 py-2 text-sm text-status-error">
            No se pudo comprobar el contenido del embudo. Sin eso no se puede
            retirar con seguridad.
          </p>
        )}

        {r && (
          <>
            {r.oportunidades.total === 0 ? (
              <p className="mt-4 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm text-neutral-700">
                Este embudo no tiene ninguna oportunidad.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="flex gap-2 rounded-md border border-status-warning/30 bg-status-warning-surface px-3 py-2.5">
                  <AlertTriangle
                    size={16}
                    className="mt-0.5 shrink-0 text-status-warning"
                  />
                  <p className="text-sm text-neutral-800">
                    Tiene{" "}
                    <strong>
                      {r.oportunidades.total}{" "}
                      {r.oportunidades.total === 1
                        ? "oportunidad"
                        : "oportunidades"}
                    </strong>
                    . No se van a eliminar: elige si prefieres archivarlo tal
                    como está o trasladarlas a otro embudo.
                  </p>
                </div>

                <ul className="space-y-1 text-sm text-neutral-700">
                  {r.porEtapa
                    .filter((e) => e.total > 0)
                    .map((e) => (
                      <li
                        key={e.stageId}
                        className="flex justify-between gap-2"
                      >
                        <span>{e.nombre}</span>
                        <span className="font-mono text-neutral-900">
                          {e.total}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            )}

            {r.motivo && r.oportunidades.total === 0 && (
              <p className="mt-3 rounded-md bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
                {r.motivo}
              </p>
            )}

            {/* Traslado: solo tiene sentido si hay algo que trasladar. */}
            {r.oportunidades.total > 0 && (
              <div className="mt-5 rounded-md border border-neutral-200 p-3">
                <p className="mb-2 text-sm font-medium text-neutral-800">
                  Trasladar a otro embudo
                </p>

                {candidatos.length === 0 ? (
                  <p className="text-sm text-neutral-600">
                    No hay otro embudo activo al que trasladarlas. Crea uno
                    antes, o archiva este para conservarlas donde están.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <label className="block">
                      <span className="text-xs text-neutral-600">Embudo</span>
                      <select
                        value={destinoPipeline}
                        onChange={(e) => {
                          setDestinoPipeline(e.target.value);
                          setDestinoEtapa("");
                        }}
                        aria-label="Embudo de destino"
                        className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
                      >
                        <option value="">Elige un embudo…</option>
                        {candidatos.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="text-xs text-neutral-600">Etapa</span>
                      <select
                        value={destinoEtapa}
                        onChange={(e) => setDestinoEtapa(e.target.value)}
                        disabled={!destinoPipeline}
                        aria-label="Etapa de destino"
                        className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500 disabled:bg-neutral-50 disabled:text-neutral-400"
                      >
                        <option value="">Elige una etapa…</option>
                        {etapasDestino.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <button
                      disabled={!destinoPipeline || !destinoEtapa || trabajando}
                      onClick={() =>
                        ejecutar(
                          () =>
                            trasladarOportunidades(pipeline.id, {
                              pipelineDestinoId: destinoPipeline,
                              etapaDestinoId: destinoEtapa,
                            }),
                          `Se trasladaron ${r.oportunidades.total} oportunidades. Ahora el embudo se puede eliminar.`,
                        )
                      }
                      className="flex w-full items-center justify-center gap-2 rounded-md bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-900 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {trabajando ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <ArrowRight size={15} />
                      )}
                      Trasladar {r.oportunidades.total}{" "}
                      {r.oportunidades.total === 1
                        ? "oportunidad"
                        : "oportunidades"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {error && (
              <p className="mt-3 rounded-md bg-status-error-surface px-3 py-2 text-sm text-status-error">
                {error}
              </p>
            )}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                onClick={onClose}
                className="rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
              >
                Cancelar
              </button>

              {r.puede.archivar && (
                <button
                  disabled={trabajando}
                  onClick={() =>
                    ejecutar(
                      () => archivarPipeline(pipeline.id),
                      r.oportunidades.total > 0
                        ? `«${pipeline.name}» quedó archivado con sus ${r.oportunidades.total} oportunidades intactas.`
                        : `«${pipeline.name}» quedó archivado.`,
                    )
                  }
                  className="rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-800 hover:bg-neutral-50 disabled:opacity-40"
                >
                  Archivar
                </button>
              )}

              <button
                disabled={!r.puede.eliminar || trabajando}
                title={r.puede.eliminar ? undefined : (r.motivo ?? undefined)}
                onClick={() =>
                  ejecutar(
                    () => deletePipeline(pipeline.id),
                    `«${pipeline.name}» se eliminó.`,
                  )
                }
                className="rounded-md bg-status-error px-4 py-2 text-sm font-medium text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Eliminar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
