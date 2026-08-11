'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import {
  CLASE_ESTADO,
  ETIQUETA_ESTADO,
  FILAS_RESUMEN,
  approveDeletion,
  executeDeletion,
  getDeletionRequests,
  previewDeletion,
  rejectDeletion,
  type PrevisualizacionEliminacion,
  type SolicitudPlataforma,
} from '@/lib/deletion-requests';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * Solicitudes de eliminación. Solo plataforma.
 *
 * La pantalla reproduce el proceso del backend en vez de resumirlo en un botón:
 * aprobar y ejecutar son dos pasos, ejecutar exige teclear el nombre exacto de
 * la empresa, y el recuento de lo que se va a borrar se enseña antes. Si la
 * interfaz permitiera hacerlo de un tirón, las tres barreras del servidor
 * seguirían ahí pero nadie las viviría como tales.
 */
export default function DeletionRequestsPage() {
  const user = useAuthStore((s) => s.user);
  const esPlataforma =
    user?.role === 'SUPER_ADMIN' && user?.companyId === null;

  if (!esPlataforma) {
    return (
      <div>
        <h2 className="text-xl font-semibold text-neutral-900">
          Solicitudes de eliminación
        </h2>
        <div className="mt-6 rounded-lg border border-neutral-200 bg-white p-4">
          <p className="text-sm text-neutral-600">
            Solo el equipo de plataforma puede revisar y ejecutar
            eliminaciones. Un administrador de empresa puede pedirla desde
            Ajustes → Datos, pero no consumarla.
          </p>
        </div>
      </div>
    );
  }

  return <Panel />;
}

function Panel() {
  const queryClient = useQueryClient();
  const [filtro, setFiltro] = useState<string>('PENDING');
  const [abierta, setAbierta] = useState<string | null>(null);

  const { data: solicitudes, isLoading, isError } = useQuery({
    queryKey: ['platform', 'deletion-requests', filtro],
    queryFn: () => getDeletionRequests(filtro || undefined),
  });

  async function refrescar() {
    await queryClient.invalidateQueries({
      queryKey: ['platform', 'deletion-requests'],
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-neutral-900">
          Solicitudes de eliminación
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          Aprobar y ejecutar exigen personas distintas. Ejecutar borra los datos
          de la empresa y no se deshace.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <span className="text-neutral-600">Estado</span>
        <select
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          aria-label="Filtrar por estado"
          className="rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-neutral-500"
        >
          <option value="">Todas</option>
          <option value="PENDING">Pendientes</option>
          <option value="APPROVED">Aprobadas</option>
          <option value="REJECTED">Rechazadas</option>
          <option value="COMPLETED">Ejecutadas</option>
        </select>
      </label>

      {isLoading ? (
        <p className="text-sm text-neutral-500">Cargando…</p>
      ) : isError ? (
        <p role="alert" className="text-sm text-status-error">
          No se pudieron cargar las solicitudes.
        </p>
      ) : !solicitudes?.length ? (
        <EmptyState
          icon={ShieldAlert}
          message="No hay solicitudes con ese estado."
        />
      ) : (
        <ul className="space-y-2">
          {solicitudes.map((s) => (
            <Fila
              key={s.id}
              solicitud={s}
              abierta={abierta === s.id}
              onAlternar={() => setAbierta(abierta === s.id ? null : s.id)}
              onCambio={refrescar}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Fila({
  solicitud,
  abierta,
  onAlternar,
  onCambio,
}: {
  solicitud: SolicitudPlataforma;
  abierta: boolean;
  onAlternar: () => void;
  onCambio: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [motivoRechazo, setMotivoRechazo] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [ejecutado, setEjecutado] = useState<string | null>(null);

  const { data: previsualizacion } = useQuery<PrevisualizacionEliminacion>({
    queryKey: ['platform', 'deletion-preview', solicitud.id],
    queryFn: () => previewDeletion(solicitud.id),
    enabled: abierta,
  });

  async function accion(fn: () => Promise<unknown>) {
    setError(null);
    setOcupado(true);
    try {
      await fn();
      await onCambio();
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo completar la acción.'));
    } finally {
      setOcupado(false);
    }
  }

  const nombreExacto = solicitud.company.name;
  const confirmacionValida = confirmacion.trim() === nombreExacto;

  return (
    <li className="rounded-lg border border-neutral-200 bg-white">
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={abierta}
        className="flex w-full flex-wrap items-center gap-2 p-3 text-left"
      >
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
            CLASE_ESTADO[solicitud.status]
          }`}
        >
          {ETIQUETA_ESTADO[solicitud.status]}
        </span>
        <span className="text-sm font-medium text-neutral-900">
          {solicitud.company.name}
        </span>
        <span className="ml-auto text-xs text-neutral-400">
          {new Date(solicitud.requestedAt).toLocaleString('es-CO')}
        </span>
      </button>

      {abierta && (
        <div className="space-y-3 border-t border-neutral-100 p-3">
          {solicitud.reason && (
            <p className="text-xs text-neutral-600">
              <span className="font-medium text-neutral-700">Motivo: </span>
              {solicitud.reason}
            </p>
          )}
          {solicitud.rejectionReason && (
            <p className="text-xs text-neutral-600">
              <span className="font-medium text-neutral-700">
                Motivo del rechazo:{' '}
              </span>
              {solicitud.rejectionReason}
            </p>
          )}

          <div className="rounded-md bg-neutral-50 p-2.5">
            <p className="text-[11px] font-medium text-neutral-700">
              Se eliminaría
            </p>
            {!previsualizacion ? (
              <p className="text-xs text-neutral-500">Contando…</p>
            ) : (
              <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-4">
                {FILAS_RESUMEN.map(({ clave, etiqueta }) => (
                  <div key={clave} className="flex justify-between text-xs">
                    <dt className="text-neutral-500">{etiqueta}</dt>
                    <dd className="font-medium text-neutral-800">
                      {previsualizacion.resumen[clave].toLocaleString('es-CO')}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="mt-1.5 text-[11px] text-neutral-500">
              La ficha de la empresa NO se borra: sin ella, la auditoría de este
              borrado no tendría a qué apuntar.
            </p>
          </div>

          {solicitud.status === 'PENDING' && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={ocupado}
                  onClick={() => void accion(() => approveDeletion(solicitud.id))}
                >
                  Aprobar
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={ocupado || motivoRechazo.trim().length < 3}
                  onClick={() =>
                    void accion(() =>
                      rejectDeletion(solicitud.id, motivoRechazo.trim()),
                    )
                  }
                >
                  Rechazar
                </Button>
              </div>
              <input
                value={motivoRechazo}
                onChange={(e) => setMotivoRechazo(e.target.value)}
                placeholder="Motivo del rechazo"
                aria-label="Motivo del rechazo"
                className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs outline-none focus:border-neutral-500"
              />
              <p className="text-[11px] text-neutral-500">
                Aprobar no borra nada: habilita el segundo paso, que ejecuta una
                persona distinta.
              </p>
            </div>
          )}

          {solicitud.status === 'APPROVED' && (
            <div className="space-y-2 rounded-md border border-status-error/20 bg-status-error-surface p-2.5">
              <p className="flex items-center gap-1.5 text-xs font-medium text-status-error">
                <AlertTriangle size={13} />
                Punto sin retorno
              </p>
              <p className="text-[11px] text-status-error">
                Escribe el nombre exacto de la empresa para confirmar:{' '}
                <span className="font-mono">{nombreExacto}</span>
              </p>
              <input
                value={confirmacion}
                onChange={(e) => setConfirmacion(e.target.value)}
                placeholder={nombreExacto}
                aria-label="Nombre exacto de la empresa"
                className="w-full rounded-md border border-status-error/30 px-2 py-1.5 text-xs outline-none focus:border-status-error"
              />
              <Button
                size="sm"
                variant="danger"
                disabled={ocupado || !confirmacionValida}
                onClick={() =>
                  void accion(async () => {
                    const r = await executeDeletion(
                      solicitud.id,
                      confirmacion.trim(),
                    );
                    setEjecutado(
                      `Eliminados ${r.resumen.mensajes.toLocaleString(
                        'es-CO',
                      )} mensajes y ${r.resumen.conversaciones.toLocaleString(
                        'es-CO',
                      )} conversaciones.`,
                    );
                    setConfirmacion('');
                  })
                }
              >
                Ejecutar eliminación
              </Button>
            </div>
          )}

          {ejecutado && (
            <p className="text-xs text-status-success-strong">{ejecutado}</p>
          )}
          {error && (
            <p role="alert" className="text-xs text-status-error">
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * El servidor dice exactamente por qué rechaza —quien pidió no puede aprobar,
 * quien aprobó no puede ejecutar, la confirmación no coincide— y ese texto es
 * la mitad del control. Sustituirlo por un genérico lo perdería.
 */
function mensajeDeError(e: unknown, respaldo: string) {
  const detalle = (e as { response?: { data?: { message?: unknown } } })
    ?.response?.data?.message;
  if (typeof detalle === 'string') return detalle;
  if (Array.isArray(detalle) && typeof detalle[0] === 'string') return detalle[0];
  return respaldo;
}
