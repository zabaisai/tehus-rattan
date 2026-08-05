"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { getImpactoContacto, eliminarContactoDefinitivo } from "@/lib/contacts";
import { Contact } from "@/types";

/** La frase exacta. El servidor la vuelve a comprobar. */
const FRASE = "ELIMINAR DEFINITIVAMENTE";

const ETIQUETAS: Record<string, string> = {
  conversaciones: "conversaciones",
  mensajes: "mensajes",
  oportunidades: "oportunidades",
  tareas: "tareas",
  cotizaciones: "cotizaciones",
  notas: "notas",
  camposPersonalizados: "campos personalizados",
  ejecucionesDePulso: "ejecuciones de Pulso",
  auditorias: "registros de auditoría",
};

/**
 * Eliminación definitiva de un contacto.
 *
 * Enseña el impacto REAL —consultado al servidor— antes de dejar confirmar.
 * Un «¿seguro?» a secas se pulsa sin leerlo; aquí hay que ver las cifras y
 * escribir una frase, que es lo mínimo para una acción sin vuelta atrás.
 */
export function EliminarContactoDialog({
  contact,
  onClose,
  onDone,
}: {
  contact: Contact;
  onClose: () => void;
  onDone: (accion: "borrado" | "anonimizado") => void;
}) {
  const [texto, setTexto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    data: impacto,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["contacto-impacto", contact.id],
    queryFn: () => getImpactoContacto(contact.id),
    // Consultar el impacto no cambia nada, pero tampoco sirve de nada
    // guardarlo: entre una apertura y otra pueden haber entrado mensajes.
    staleTime: 0,
  });

  const puedeConfirmar = texto.trim() === FRASE && !enviando && !!impacto;

  async function confirmar() {
    if (!puedeConfirmar) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await eliminarContactoDefinitivo(
        contact.id,
        texto.trim(),
        motivo.trim() || undefined,
      );
      onDone(r.accion);
    } catch (e: unknown) {
      const mensaje =
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "No se pudo completar la eliminación.";
      setError(mensaje);
      setEnviando(false);
    }
  }

  const relacionesConDatos = impacto
    ? Object.entries(impacto.relaciones).filter(([, n]) => n > 0)
    : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-neutral-950/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-eliminar-contacto"
    >
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-xl bg-white p-5 sm:max-w-lg sm:rounded-xl">
        <div className="flex items-start justify-between gap-3">
          <h3
            id="titulo-eliminar-contacto"
            className="text-base font-semibold text-neutral-900"
          >
            Eliminar definitivamente
          </h3>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            <X size={18} />
          </button>
        </div>

        <p className="mt-1 text-sm text-neutral-600">
          {contact.name || contact.phone}
        </p>

        {isLoading && (
          <p className="flex items-center gap-2 py-8 text-sm text-neutral-500">
            <Loader2 size={15} className="animate-spin" />
            Calculando qué se vería afectado…
          </p>
        )}

        {isError && (
          <p className="mt-4 rounded-md bg-status-error-surface px-3 py-2 text-sm text-status-error">
            No se pudo consultar el impacto. Sin esa información no se puede
            confirmar una eliminación definitiva.
          </p>
        )}

        {impacto && (
          <>
            {impacto.vacio ? (
              <div className="mt-4 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2.5">
                <p className="text-sm text-neutral-700">
                  Este contacto no tiene ninguna conversación, oportunidad ni
                  tarea. Se <strong>borrará por completo</strong>.
                </p>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="flex gap-2 rounded-md border border-status-warning/30 bg-status-warning-surface px-3 py-2.5">
                  <AlertTriangle
                    size={16}
                    className="mt-0.5 shrink-0 text-status-warning"
                  />
                  <p className="text-sm text-neutral-800">
                    Este contacto tiene historia. Se{" "}
                    <strong>eliminarán sus datos personales</strong> (nombre,
                    teléfono, correo, etiquetas y campos personalizados) y{" "}
                    <strong>se conservará el registro comercial</strong>.
                  </p>
                </div>

                <div>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-neutral-500">
                    Lo que existe hoy
                  </p>
                  <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-neutral-700">
                    {relacionesConDatos.map(([clave, n]) => (
                      <li key={clave} className="flex justify-between gap-2">
                        <span>{ETIQUETAS[clave] ?? clave}</span>
                        <span className="font-mono text-neutral-900">{n}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-neutral-500">
                    Se conserva
                  </p>
                  <ul className="list-inside list-disc space-y-0.5 text-sm text-neutral-600">
                    {impacto.seConservan.map((linea) => (
                      <li key={linea}>{linea}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <label className="mt-4 block">
              <span className="text-sm text-neutral-700">
                Motivo <span className="text-neutral-400">(opcional)</span>
              </span>
              <input
                type="text"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                maxLength={500}
                placeholder="Por ejemplo: el cliente solicitó la supresión de sus datos"
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
              />
            </label>

            <label className="mt-3 block">
              <span className="text-sm text-neutral-700">
                Escribe <code className="font-mono font-semibold">{FRASE}</code>{" "}
                para confirmar
              </span>
              <input
                type="text"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                autoComplete="off"
                aria-label={`Escribe ${FRASE} para confirmar`}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm outline-none focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500"
              />
            </label>

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
              <button
                onClick={confirmar}
                disabled={!puedeConfirmar}
                className="flex items-center justify-center gap-2 rounded-md bg-status-error px-4 py-2 text-sm font-medium text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {enviando && <Loader2 size={15} className="animate-spin" />}
                {impacto.vacio
                  ? "Borrar contacto"
                  : "Eliminar datos personales"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
