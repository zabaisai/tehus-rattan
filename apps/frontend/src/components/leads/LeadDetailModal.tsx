'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { getLead, updateLead, markLeadWon, markLeadLost } from '@/lib/leads';
import { changeLeadStage } from '@/lib/pipeline';
import { getCompanyUsers } from '@/lib/users';
import { PipelineStage } from '@/types';

type ApiError = {
  response?: {
    data?: {
      message?: string | string[];
    };
  };
};

function formatCurrency(value: number | null) {
  if (!value) return null;
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

const statusLabels: Record<string, string> = {
  OPEN: 'Abierto',
  WON: 'Ganado',
  LOST: 'Perdido',
};

const statusColors: Record<string, string> = {
  OPEN: 'bg-stone-100 text-stone-600',
  WON: 'bg-green-50 text-green-700',
  LOST: 'bg-red-50 text-red-700',
};

interface LeadDetailModalProps {
  leadId: string;
  stages: PipelineStage[];
  onClose: () => void;
  onChanged: () => void;
}

export function LeadDetailModal({ leadId, stages, onClose, onChanged }: LeadDetailModalProps) {
  const queryClient = useQueryClient();
  const queryKey = ['lead', leadId];

  const { data: lead, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => getLead(leadId),
  });

  const { data: users } = useQuery({
    queryKey: ['company-users'],
    queryFn: getCompanyUsers,
  });

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [expectedCloseDate, setExpectedCloseDate] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [lostReasonOpen, setLostReasonOpen] = useState(false);
  const [lostReasonDraft, setLostReasonDraft] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  function startEditing() {
    if (!lead) return;
    setTitle(lead.title);
    setValue(lead.value ? String(lead.value) : '');
    setExpectedCloseDate(lead.expectedCloseDate ? lead.expectedCloseDate.slice(0, 10) : '');
    setAssignedTo(lead.assignedTo ?? '');
    setError('');
    setEditing(true);
  }

  function flashSaved() {
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2500);
  }

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey });
    onChanged();
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await updateLead(leadId, {
        title,
        value: value ? Number(value) : undefined,
        expectedCloseDate: expectedCloseDate
          ? new Date(expectedCloseDate).toISOString()
          : undefined,
        ...(assignedTo ? { assignedTo } : {}),
      });
      await refresh();
      setEditing(false);
      flashSaved();
    } catch (err) {
      const message = (err as ApiError).response?.data?.message;
      const errorMessage = Array.isArray(message) ? message[0] : message;
      setError(errorMessage || 'Ocurrió un error');
    } finally {
      setSaving(false);
    }
  }

  async function handleStageChange(newStageId: string) {
    if (!lead || newStageId === lead.stage.id) return;
    setError('');
    setSaving(true);
    try {
      await changeLeadStage(leadId, newStageId);
      await refresh();
      flashSaved();
    } catch (err) {
      const message = (err as ApiError).response?.data?.message;
      const errorMessage = Array.isArray(message) ? message[0] : message;
      setError(errorMessage || 'No se pudo cambiar la etapa');
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkWon() {
    setError('');
    setSaving(true);
    try {
      await markLeadWon(leadId);
      await refresh();
      flashSaved();
    } catch (err) {
      const message = (err as ApiError).response?.data?.message;
      const errorMessage = Array.isArray(message) ? message[0] : message;
      setError(errorMessage || 'No se pudo marcar como ganado');
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmLost() {
    setError('');
    setSaving(true);
    try {
      await markLeadLost(leadId, lostReasonDraft || undefined);
      await refresh();
      setLostReasonOpen(false);
      setLostReasonDraft('');
      flashSaved();
    } catch (err) {
      const message = (err as ApiError).response?.data?.message;
      const errorMessage = Array.isArray(message) ? message[0] : message;
      setError(errorMessage || 'No se pudo marcar como perdido');
    } finally {
      setSaving(false);
    }
  }

  const sortedStages = [...stages].sort((a, b) => a.order - b.order);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-stone-900">Detalle del lead</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700">
            <X size={18} />
          </button>
        </div>

        {isLoading && <p className="text-sm text-stone-400">Cargando...</p>}
        {isError && <p className="text-sm text-red-600">No se pudo cargar el lead.</p>}

        {lead && !editing && (
          <div>
            <div className="mb-3 flex items-start justify-between gap-2">
              <p className="text-base font-medium text-stone-900">{lead.title}</p>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${statusColors[lead.status]}`}>
                {statusLabels[lead.status]}
              </span>
            </div>

            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-xs font-medium text-stone-500">Contacto</dt>
                <dd className="text-stone-800">{lead.contact.name || lead.contact.phone}</dd>
              </div>

              <div>
                <dt className="text-xs font-medium text-stone-500">Pipeline / etapa</dt>
                <dd className="flex items-center gap-2 text-stone-800">
                  <span>{lead.pipeline.name}</span>
                  <span className="text-stone-300">·</span>
                  <select
                    value={lead.stage.id}
                    onChange={(e) => handleStageChange(e.target.value)}
                    disabled={saving}
                    className="rounded-md border border-stone-300 px-1.5 py-1 text-xs outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500 disabled:bg-stone-100"
                  >
                    {sortedStages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </dd>
              </div>

              {formatCurrency(lead.value) && (
                <div>
                  <dt className="text-xs font-medium text-stone-500">Valor</dt>
                  <dd className="text-stone-800">{formatCurrency(lead.value)}</dd>
                </div>
              )}

              {formatDate(lead.expectedCloseDate) && (
                <div>
                  <dt className="text-xs font-medium text-stone-500">Cierre esperado</dt>
                  <dd className="text-stone-800">{formatDate(lead.expectedCloseDate)}</dd>
                </div>
              )}

              <div>
                <dt className="text-xs font-medium text-stone-500">Responsable</dt>
                <dd className="text-stone-800">{lead.agent?.name || 'Sin asignar'}</dd>
              </div>

              {lead.status === 'LOST' && lead.lostReason && (
                <div>
                  <dt className="text-xs font-medium text-stone-500">Motivo de pérdida</dt>
                  <dd className="text-stone-800">{lead.lostReason}</dd>
                </div>
              )}
            </dl>

            {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
            {justSaved && !error && <p className="mt-3 text-xs text-green-600">Cambios guardados</p>}

            {lostReasonOpen && (
              <div className="mt-3 rounded-md border border-stone-200 bg-stone-50 p-3">
                <label className="mb-1 block text-xs font-medium text-stone-600">
                  Motivo de pérdida (opcional)
                </label>
                <textarea
                  value={lostReasonDraft}
                  onChange={(e) => setLostReasonDraft(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
                />
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setLostReasonOpen(false);
                      setLostReasonDraft('');
                    }}
                    className="rounded-md px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-100"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmLost}
                    disabled={saving}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {saving ? 'Guardando...' : 'Confirmar pérdida'}
                  </button>
                </div>
              </div>
            )}

            {!lostReasonOpen && (
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={startEditing}
                  className="rounded-md px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100"
                >
                  Editar
                </button>
                {lead.status === 'OPEN' && (
                  <>
                    <button
                      type="button"
                      onClick={() => setLostReasonOpen(true)}
                      disabled={saving}
                      className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      Marcar perdido
                    </button>
                    <button
                      type="button"
                      onClick={handleMarkWon}
                      disabled={saving}
                      className="rounded-md bg-green-700 px-3 py-1.5 text-sm text-white hover:bg-green-800 disabled:opacity-50"
                    >
                      Marcar ganado
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {lead && editing && (
          <form onSubmit={handleSaveEdit}>
            <div className="mb-3">
              <label className="mb-1 block text-xs font-medium text-stone-600">Título</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
              />
            </div>

            <div className="mb-3 grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-stone-600">Valor</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="w-full rounded-md border border-stone-300 px-2 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-stone-600">Cierre esperado</label>
                <input
                  type="date"
                  value={expectedCloseDate}
                  onChange={(e) => setExpectedCloseDate(e.target.value)}
                  className="w-full rounded-md border border-stone-300 px-2 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="mb-1 block text-xs font-medium text-stone-600">Responsable</label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="w-full rounded-md border border-stone-300 px-2 py-2 text-sm outline-none focus:border-stone-500 focus:ring-1 focus:ring-stone-500"
              >
                <option value="">Sin asignar</option>
                {users
                  ?.filter((u) => u.isActive)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </select>
              {!assignedTo && lead.assignedTo && (
                <p className="mt-1 text-[11px] text-stone-400">
                  Este lead ya tiene responsable asignado; el backend no permite quitarlo, solo reasignarlo.
                </p>
              )}
            </div>

            {error && <p className="mb-3 text-xs text-red-600">{error}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setError('');
                }}
                className="rounded-md px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white hover:bg-stone-800 disabled:opacity-50"
              >
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
